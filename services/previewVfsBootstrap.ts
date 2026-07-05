/**
 * VFS Sandbox bootstrap (選項 A, plan v2) — services/html-canvas-vfs-sandbox-plan.md
 *
 * The bootstrap is a self-contained IIFE injected into the preview blob's `<head>`.
 * It runs inside the sandboxed iframe (opaque origin — no allow-same-origin) and:
 *   1. Reads the VFS manifest from a sibling `<script type="application/json" data-vfs-manifest>`.
 *   2. Creates a per-file Blob + URL.createObjectURL in asset → css → js order, rewriting
 *      CSS url()/@import references to asset blob URLs (V7). Module specifier rewrite to
 *      `vfs:/path` is done at BUILD time (V3); the bootstrap only registers the import map.
 *   3. Injects an import map `<script type="importmap">` mapping `vfs:/path → blob URL` (V3).
 *      All module blobs exist before the map is assembled → circular deps resolve naturally.
 *   4. Patches window.fetch: relative path in fileMap → Response(blob); relative miss →
 *      report `missing_reference` runtime diagnostic then passthrough; absolute URL passthrough (V6).
 *   5. At DOMContentLoaded, rewrites `[data-vfs]` element src/href/srcset + inline `<style>`
 *      url()/@import to blob URLs (V7/V10), then dynamic-imports entry modules in document order.
 *   6. ALWAYS dispatches `vfs:ready` (success or degraded) via window.__vfsReady__ + a
 *      `vfs:ready` CustomEvent, buffering any errors in window.__vfsErrors__ for the harness
 *      bridge to drain (V1/V4). Never deadlocks.
 *
 * Pure helpers (resolveRelativePath / resolveFetchPath / rewriteCssUrls / rewriteSrcset) are
 * exported and unit-tested directly; the IIFE below inlines equivalent logic and the full path
 * is validated end-to-end by tests/e2e/vfs-preview.spec.ts. This mirrors how the G1 runtime
 * bridge (htmlPreviewService.ts) co-exists with its mirrored helpers in previewRuntimeDiagnostics.ts.
 */

export interface VfsManifestFile {
  /** Normalized absolute project path, e.g. `/styles/app.css`, `/src/utils.js`. */
  path: string;
  /** HtmlProjectFileKind-derived category. */
  kind: 'css' | 'js' | 'svg' | 'asset' | 'json' | 'md' | 'html';
  mime: string;
  encoding: 'utf-8' | 'base64';
  content: string;
  /** True for JS files that participate in the `vfs:/path` import map. */
  isModule: boolean;
}

export interface VfsManifestEntryModule {
  /** For external module scripts: the file path. For inline modules: a synthetic path. */
  path: string;
}

export interface VfsManifest {
  files: VfsManifestFile[];
  entryModules: VfsManifestEntryModule[];
}

const EXTERNAL_REF_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;

/** Resolve a possibly-relative target path against a base file path. Pure. */
export function resolveRelativePath(basePath: string, targetPath: string): string {
  if (EXTERNAL_REF_PATTERN.test(targetPath)) {
    return targetPath;
  }
  if (targetPath.startsWith('/')) {
    return targetPath.startsWith('//')
      ? targetPath
      : `/${targetPath.slice(1)}`.replace(/\/+/g, '/');
  }
  const baseSegments = basePath.split('/').slice(0, -1);
  for (const segment of targetPath.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      baseSegments.pop();
      continue;
    }
    baseSegments.push(segment);
  }
  const joined = `/${baseSegments.join('/')}`;
  return joined.replace(/\/+/g, '/');
}

/**
 * Resolve a fetch() input URL to an absolute project path, or null if it is
 * external/absolute (scheme, protocol-relative, hash, data:, blob:) and should passthrough.
 * Query/hash fragments are stripped. Pure.
 */
export function resolveFetchPath(url: string): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }
  // Check the ORIGINAL url for external scheme / protocol-relative / pure fragment first —
  // a "#anchor" must passthrough, not resolve to "/".
  if (EXTERNAL_REF_PATTERN.test(url)) {
    return null;
  }
  const clean = url.split('#')[0].split('?')[0];
  if (!clean) {
    return null;
  }
  // Resolve relative to the document root "/" (blob documents have no usable base).
  return resolveRelativePath('/', clean);
}

/** Rewrite url(...) and @import references in CSS text to blob URLs from fileMap. Pure. */
export function rewriteCssUrls(
  css: string,
  basePath: string,
  fileMap: Record<string, string>,
): string {
  if (!css) {
    return css;
  }
  const resolveRef = (ref: string): string | null => {
    if (!ref || EXTERNAL_REF_PATTERN.test(ref)) {
      return null;
    }
    const resolved = resolveRelativePath(basePath, ref);
    return Object.prototype.hasOwnProperty.call(fileMap, resolved) ? resolved : null;
  };

  let out = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _q, ref) => {
    const resolved = resolveRef(ref);
    return resolved ? `url(${fileMap[resolved]})` : full;
  });

  out = out.replace(
    /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?\s*([^;]*);?/gi,
    (full, _q, ref, tail) => {
      const resolved = resolveRef(ref);
      if (!resolved) {
        return full;
      }
      const media = tail ? ` ${tail.trim()}` : '';
      return `@import url("${fileMap[resolved]}")${media};`;
    },
  );

  return out;
}

/** Rewrite a srcset attribute (comma-separated URL+descriptor list) to blob URLs. Pure. */
export function rewriteSrcset(srcset: string, fileMap: Record<string, string>): string {
  if (!srcset) {
    return srcset;
  }
  return srcset
    .split(',')
    .map(part => {
      const trimmed = part.trim();
      if (!trimmed) {
        return '';
      }
      const spaceIdx = trimmed.search(/\s/);
      const url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
      const descriptor = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx);
      const clean = url.split('#')[0].split('?')[0];
      if (EXTERNAL_REF_PATTERN.test(clean)) {
        return trimmed;
      }
      const resolved = resolveRelativePath('/', clean);
      return Object.prototype.hasOwnProperty.call(fileMap, resolved)
        ? `${fileMap[resolved]}${descriptor}`
        : trimmed;
    })
    .filter(Boolean)
    .join(', ');
}

export interface VfsAssemblyResult {
  fileMap: Record<string, string>;
  moduleUrls: Record<string, string>;
  degraded: boolean;
  errors: string[];
}

/**
 * Pure-logic core of bootstrap step 2: create Blobs in asset → css → js order, rewriting
 * CSS url()/@import to asset blob URLs. Uses global Blob + URL.createObjectURL (jsdom provides
 * Blob; URL.createObjectURL is stubbed in src/test/setup.ts). Unit-tested directly.
 *
 * CSS @import chains are handled with a second pass: after pass 1 every CSS blob exists in
 * fileMap, so pass 2 rewrites any @import to any project CSS file.
 */
export function assembleVfs(manifest: VfsManifest): VfsAssemblyResult {
  const fileMap: Record<string, string> = {};
  const moduleUrls: Record<string, string> = {};
  const errors: string[] = [];
  let degraded = false;

  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const decodeBase64 = (b64: string): Uint8Array => {
    const bin = globalThis.atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  };
  const makeBlob = (file: VfsManifestFile) => {
    if (file.encoding === 'base64') {
      return new globalThis.Blob([decodeBase64(file.content)], {
        type: file.mime || 'application/octet-stream',
      });
    }
    return new globalThis.Blob([file.content], { type: file.mime || 'text/plain' });
  };
  const create = (file: VfsManifestFile, cssContent?: string): string | null => {
    try {
      const blob =
        cssContent !== undefined
          ? new globalThis.Blob([cssContent], { type: file.mime || 'text/css' })
          : makeBlob(file);
      const url = URL.createObjectURL(blob);
      fileMap[file.path] = url;
      if (file.isModule) {
        moduleUrls[`vfs:${file.path}`] = url;
      }
      return url;
    } catch (e) {
      degraded = true;
      errors.push(
        `VFS blob creation failed for ${file.path}: ${(e as Error)?.message ?? String(e)}`,
      );
      return null;
    }
  };

  // Phase A: assets (everything that is not css/js).
  for (const file of files) {
    if (file.kind !== 'css' && file.kind !== 'js') {
      create(file);
    }
  }

  const cssFiles = files.filter(f => f.kind === 'css');
  // CSS phase — fixed-point (max 3 iterations): each iteration computes rewritten content for
  // EVERY css file from the current fileMap, THEN recreates their blobs. Computing all before
  // recreating any avoids within-iteration staleness. Stops once content stabilizes, so a
  // project with no inter-CSS @import pays only a single pass (no redundant blobs).
  let prevCssContents: Record<string, string> = {};
  for (let iter = 0; iter < 3 && cssFiles.length > 0; iter++) {
    const rewritten: Record<string, string> = {};
    let changed = false;
    for (const file of cssFiles) {
      const r = rewriteCssUrls(file.content, file.path, fileMap);
      rewritten[file.path] = r;
      if (prevCssContents[file.path] !== r) {
        changed = true;
      }
    }
    if (iter > 0 && !changed) {
      break;
    }
    for (const file of cssFiles) {
      create(file, rewritten[file.path]);
    }
    prevCssContents = rewritten;
  }

  // Phase C: JS modules (specifiers already rewritten to vfs:/path at build time).
  for (const file of files) {
    if (file.kind === 'js') {
      create(file);
    }
  }

  return { fileMap, moduleUrls, degraded, errors };
}

/**
 * Serialize a manifest for safe embedding inside `<script type="application/json" data-vfs-manifest>`.
 * The HTML parser ends any `<script>` block at the first `</script>`, so every `<` is escaped to
 * the JSON escape `<` (which JSON.parse turns back into `<`). U+2028/U+2029 are escaped too
 * (V2). The result is a valid JSON document that contains no literal `</`.
 */
export function serializeVfsManifest(manifest: VfsManifest): string {
  return JSON.stringify(manifest)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Build the VFS bootstrap `<script data-vfs-bootstrap>` string. The IIFE reads the manifest
 * from `script[data-vfs-manifest]` (which the caller injects as a sibling, immediately before
 * this script — same pattern as the G1 harness meta tag).
 *
 * NOTE: the body is plain ES5-style JS (var, function) so it runs as a classic parser-inserted
 * script in `<head>` and cannot collide with project globals. Dynamic `import()` is allowed in
 * classic scripts and is used to load module entrypoints after the import map is injected.
 */
export function buildVfsBootstrapScript(options: {
  projectId: string;
  previewVersion: number;
}): string {
  const projectId = options.projectId;
  const previewVersion = options.previewVersion;

  const body = `
    (function () {
      var PROJECT_ID = ${JSON.stringify(projectId)};
      var PREVIEW_VERSION = ${JSON.stringify(previewVersion)};
      var MAX_BUFFER = 50;
      var degraded = false;
      var errorBuffer = [];

      function pushError(message) {
        if (typeof message !== 'string' || !message) {
          return;
        }
        if (errorBuffer.length >= MAX_BUFFER) {
          return;
        }
        errorBuffer.push({ kind: 'error', message: message, timestamp: Date.now() });
      }

      function postToParent(type, payload) {
        try {
          var msg = Object.assign(
            { type: type, projectId: PROJECT_ID, previewVersion: PREVIEW_VERSION },
            payload || {}
          );
          if (window.parent && typeof window.parent.postMessage === 'function') {
            window.parent.postMessage(msg, '*');
          }
        } catch (_) { /* never let telemetry break the page */ }
      }

      function reportMissingReference(resolvedPath) {
        var entry = {
          kind: 'missing_reference',
          message: 'fetch() referenced a missing project file: ' + resolvedPath,
          timestamp: Date.now(),
        };
        errorBuffer.push(entry);
        postToParent('runtime-errors', { errors: [entry] });
      }

      function signalReady() {
        // Signal the in-iframe harness bridge (V1/V4). The bridge owns the parent-facing
        // 'ready' ack — it drains window.__vfsErrors__ and posts ready on vfs:ready (or its
        // window 'load' fallback). The bootstrap itself never posts 'ready' to the parent,
        // avoiding duplicate acks.
        try {
          window.__vfsReady__ = { done: true, degraded: degraded };
          window.__vfsErrors__ = errorBuffer;
        } catch (_) { /* ignore */ }
        try {
          var evt = new CustomEvent('vfs:ready', { detail: { degraded: degraded } });
          window.dispatchEvent(evt);
        } catch (_) {
          // CustomEvent unavailable — the bridge's window 'load' fallback still guarantees a
          // ready ack, so we never deadlock.
        }
      }

      function readManifest() {
        try {
          var node = document.currentScript
            ? document.currentScript.previousElementSibling
            : null;
          if (!node || node.tagName !== 'SCRIPT' || !node.hasAttribute('data-vfs-manifest')) {
            var nodes = document.querySelectorAll('script[data-vfs-manifest]');
            node = nodes.length > 0 ? nodes[nodes.length - 1] : null;
          }
          if (!node || !node.textContent) {
            return null;
          }
          return JSON.parse(node.textContent);
        } catch (e) {
          degraded = true;
          pushError('VFS manifest parse failed: ' + ((e && e.message) || String(e)));
          return null;
        }
      }

      var EXTERNAL_REF = /^(?:[a-z][a-z0-9+.-]*:|#|\\/\\/)/i;
      function resolveRelative(basePath, targetPath) {
        if (EXTERNAL_REF.test(targetPath)) return targetPath;
        if (targetPath.charAt(0) === '/') {
          return targetPath.replace(/\\/+/g, '/');
        }
        var baseSegments = basePath.split('/').slice(0, -1);
        var segs = targetPath.split('/');
        for (var i = 0; i < segs.length; i++) {
          var s = segs[i];
          if (!s || s === '.') continue;
          if (s === '..') { baseSegments.pop(); continue; }
          baseSegments.push(s);
        }
        return ('/' + baseSegments.join('/')).replace(/\\/+/g, '/');
      }
      function resolveFetchPath(url) {
        if (!url || typeof url !== 'string') return null;
        var clean = url.split('#')[0].split('?')[0];
        if (EXTERNAL_REF.test(clean)) return null;
        return resolveRelative('/', clean);
      }
      function rewriteCss(css, basePath, fileMap) {
        if (!css) return css;
        css = css.replace(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/gi, function (full, _q, ref) {
          if (EXTERNAL_REF.test(ref)) return full;
          var resolved = resolveRelative(basePath, ref);
          return Object.prototype.hasOwnProperty.call(fileMap, resolved) ? 'url(' + fileMap[resolved] + ')' : full;
        });
        css = css.replace(/@import\\s+(?:url\\(\\s*)?(['"])([^'"]+)\\1\\s*\\)?\\s*([^;]*);?/gi, function (full, _q, ref, tail) {
          if (EXTERNAL_REF.test(ref)) return full;
          var resolved = resolveRelative(basePath, ref);
          if (!Object.prototype.hasOwnProperty.call(fileMap, resolved)) return full;
          var media = tail ? ' ' + String(tail).replace(/^\\s+|\\s+$/g, '') : '';
          return '@import url("' + fileMap[resolved] + '")' + media + ';';
        });
        return css;
      }
      function rewriteSrcset(srcset, fileMap) {
        if (!srcset) return srcset;
        return srcset.split(',').map(function (part) {
          var trimmed = String(part).replace(/^\\s+|\\s+$/g, '');
          if (!trimmed) return '';
          var spaceIdx = trimmed.search(/\\s/);
          var url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
          var descriptor = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx);
          var clean = url.split('#')[0].split('?')[0];
          if (EXTERNAL_REF.test(clean)) return trimmed;
          var resolved = resolveRelative('/', clean);
          return Object.prototype.hasOwnProperty.call(fileMap, resolved) ? fileMap[resolved] + descriptor : trimmed;
        }).filter(Boolean).join(', ');
      }

      function decodeBase64(b64) {
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      }

      var manifest = readManifest();
      if (!manifest) {
        signalReady();
        return;
      }

      try {
        var files = (manifest && manifest.files) || [];
        var fileMap = {};
        var moduleUrls = {};

      function createBlob(file, cssContent) {
        try {
          var blob;
          if (cssContent !== undefined) {
            blob = new Blob([cssContent], { type: file.mime || 'text/css' });
          } else if (file.encoding === 'base64') {
            blob = new Blob([decodeBase64(file.content)], { type: file.mime || 'application/octet-stream' });
          } else {
            blob = new Blob([file.content], { type: file.mime || 'text/plain' });
          }
          var url = URL.createObjectURL(blob);
          fileMap[file.path] = url;
          if (file.isModule) moduleUrls['vfs:' + file.path] = url;
          return url;
        } catch (e) {
          degraded = true;
          pushError('VFS blob creation failed for ' + (file && file.path) + ': ' + ((e && e.message) || String(e)));
          return null;
        }
      }

      // Phase A: assets (non-css, non-js).
      for (var ai = 0; ai < files.length; ai++) {
        var af = files[ai];
        if (af.kind !== 'css' && af.kind !== 'js') createBlob(af);
      }
      // Phase B: CSS — fixed-point (max 3 iterations) for @import chains. Compute rewritten
      // content for ALL css files from the current fileMap, THEN recreate their blobs; repeat
      // until stable so deeper chains resolve and chain-free projects pay a single pass.
      var cssFiles = [];
      for (var ci = 0; ci < files.length; ci++) {
        if (files[ci].kind === 'css') cssFiles.push(files[ci]);
      }
      var prevCss = {};
      for (var iter = 0; iter < 3 && cssFiles.length > 0; iter++) {
        var rewrittenCss = {};
        var cssChanged = false;
        for (var ck = 0; ck < cssFiles.length; ck++) {
          var cfile = cssFiles[ck];
          var r = rewriteCss(cfile.content, cfile.path, fileMap);
          rewrittenCss[cfile.path] = r;
          if (prevCss[cfile.path] !== r) cssChanged = true;
        }
        if (iter > 0 && !cssChanged) break;
        for (var cl = 0; cl < cssFiles.length; cl++) {
          createBlob(cssFiles[cl], rewrittenCss[cssFiles[cl].path]);
        }
        prevCss = rewrittenCss;
      }
      // Phase C: JS modules.
      for (var ji = 0; ji < files.length; ji++) {
        if (files[ji].kind === 'js') createBlob(files[ji]);
      }

      // Inject import map (must precede any module load; we removed all static module scripts).
      try {
        var imports = {};
        var keys = Object.keys(moduleUrls);
        for (var ki = 0; ki < keys.length; ki++) imports[keys[ki]] = moduleUrls[keys[ki]];
        var mapScript = document.createElement('script');
        mapScript.type = 'importmap';
        mapScript.textContent = JSON.stringify({ imports: imports });
        document.head.appendChild(mapScript);
      } catch (e) {
        degraded = true;
        pushError('VFS import map injection failed: ' + ((e && e.message) || String(e)));
      }

      // Patch window.fetch.
      if (typeof window.fetch === 'function') {
        try {
          var origFetch = window.fetch.bind(window);
          window.fetch = function (input, init) {
            var url = typeof input === 'string'
              ? input
              : (input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input));
            var resolved = resolveFetchPath(url);
            if (resolved !== null) {
              if (Object.prototype.hasOwnProperty.call(fileMap, resolved)) {
                return origFetch(fileMap[resolved], init);
              }
              reportMissingReference(resolved);
            }
            return origFetch(input, init);
          };
        } catch (e) {
          degraded = true;
          pushError('VFS fetch patch failed: ' + ((e && e.message) || String(e)));
        }
      }

      } catch (setupErr) {
        // Any unexpected setup failure → degrade but still signal ready (V4: never deadlock).
        degraded = true;
        pushError('VFS setup failed: ' + ((setupErr && setupErr.message) || String(setupErr)));
        signalReady();
        return;
      }

      function rewriteElements() {
        try {
          var nodes = document.querySelectorAll('[data-vfs]');
          for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var path = el.getAttribute('data-vfs');
            if (path && Object.prototype.hasOwnProperty.call(fileMap, path)) {
              if (el.hasAttribute('src')) el.setAttribute('src', fileMap[path]);
              if (el.hasAttribute('href')) el.setAttribute('href', fileMap[path]);
            }
            var srcset = el.getAttribute('srcset');
            if (srcset) el.setAttribute('srcset', rewriteSrcset(srcset, fileMap));
          }
          var styles = document.querySelectorAll('style');
          for (var j = 0; j < styles.length; j++) {
            var css = styles[j].textContent;
            if (css) styles[j].textContent = rewriteCss(css, '/', fileMap);
          }
        } catch (e) {
          degraded = true;
          pushError('VFS element rewrite failed: ' + ((e && e.message) || String(e)));
        }
      }

      function loadEntryModules() {
        var entries = (manifest && manifest.entryModules) || [];
        if (entries.length === 0) {
          return Promise.resolve();
        }
        var promises = [];
        for (var i = 0; i < entries.length; i++) {
          var entryPath = entries[i] && entries[i].path;
          var specifier = 'vfs:' + entryPath;
          if (!Object.prototype.hasOwnProperty.call(moduleUrls, specifier)) {
            degraded = true;
            pushError('VFS entry module has no blob URL: ' + entryPath);
            continue;
          }
          try {
            // Dynamic import() resolves the vfs:/path specifier via the import map → blob URL.
            promises.push(import(specifier));
          } catch (e) {
            degraded = true;
            pushError('VFS dynamic import unavailable for ' + entryPath + ': ' + ((e && e.message) || String(e)));
          }
        }
        if (promises.length === 0) return Promise.resolve();
        return Promise.allSettled(promises).then(function (results) {
          for (var r = 0; r < results.length; r++) {
            if (results[r].status === 'rejected') {
              var reason = results[r].reason;
              pushError('VFS module error: ' + ((reason && (reason.message || String(reason))) || 'unknown'));
            }
          }
        });
      }

      function whenDomReady(cb) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', cb);
        } else {
          // Defer so the bootstrap returns and the parser continues; mimics natural deferral.
          setTimeout(cb, 0);
        }
      }

      whenDomReady(function () {
        rewriteElements();
        try {
          loadEntryModules()
            .then(signalReady)
            .catch(function (e) {
              degraded = true;
              pushError('VFS module load chain failed: ' + ((e && e.message) || String(e)));
              signalReady();
            });
        } catch (e) {
          degraded = true;
          pushError('VFS module load threw: ' + ((e && e.message) || String(e)));
          signalReady();
        }
      });
    })();
  `
    .replace(/\n\s*/g, '\n')
    .trim();

  return `<script data-vfs-bootstrap>${body}</script>`;
}
