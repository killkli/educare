import {
  HtmlProject,
  HtmlProjectFile,
  HtmlProjectPreviewArtifact,
  HtmlProjectPreviewDiagnostics,
  HtmlProjectPreviewUrlType,
} from '../types';
import { htmlProjectStore } from './htmlProjectStore';

const EXTERNAL_REF_PATTERN = /^(?:[a-z]+:|#|\/\/)/i;

const normalizePath = (path: string): string => (path.startsWith('/') ? path : `/${path}`);

const resolveRelativePath = (basePath: string, targetPath: string): string => {
  if (EXTERNAL_REF_PATTERN.test(targetPath)) {
    return targetPath;
  }

  if (targetPath.startsWith('/')) {
    return normalizePath(targetPath);
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

  return normalizePath(baseSegments.join('/'));
};

const toDataUrl = (html: string): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

const buildReadyDiagnostics = (warnings: string[]): HtmlProjectPreviewDiagnostics => ({
  category: warnings.length > 0 ? 'external_dependency_warning' : 'none',
  outcome: 'ready',
  repairable: false,
  summary:
    warnings.length > 0
      ? 'Preview rendered with external dependency warnings.'
      : 'Preview rendered successfully.',
  warnings,
  details: warnings.length > 0 ? warnings : undefined,
});

const buildMissingEntrypointDiagnostics = (entryFile: string): HtmlProjectPreviewDiagnostics => ({
  category: 'missing_entrypoint',
  outcome: 'repairable_error',
  repairable: true,
  summary: `Entrypoint ${entryFile} does not exist.`,
  missingPaths: [entryFile],
  details: ['Set a valid entry file or recreate the missing entrypoint file.'],
});

const buildMissingReferenceDiagnostics = (
  missingPaths: string[],
  warnings: string[],
): HtmlProjectPreviewDiagnostics => ({
  category: 'missing_reference',
  outcome: 'repairable_error',
  repairable: true,
  summary: `Missing preview dependencies: ${missingPaths.join(', ')}.`,
  missingPaths,
  warnings,
  details: ['Restore the missing file(s) or update the HTML references before retrying preview.'],
});

/**
 * G1 — Build the runtime bridge `<script>` injected into preview-ready artifacts.
 *
 * The bridge:
 *   - Reads projectId + previewVersion from a sibling `<script type="application/json" data-harness-meta>`
 *     element (never from URL parsing — sandboxed blobs have no usable query params).
 *   - Captures window 'error', 'unhandledrejection', and wraps console.error / console.warn.
 *   - Deduplicates entries by (kind+message), caps at 50, and truncates messages to ~500 chars.
 *   - On window 'load', postMessage `{ type:'ready', projectId, previewVersion }` to parent.
 *   - PostMessage `{ type:'runtime-errors', ... }` to parent — flushed on first error and at
 *     most every ~250ms, plus a final flush on pagehide/beforeunload.
 *
 * The bridge is self-contained (no external references) and idempotent — it guards against
 * double-install via a `window.__harnessRuntimeBridgeInstalled__` sentinel.
 */
const buildHarnessMetaScript = (projectId: string, previewVersion: number): string => {
  const meta = JSON.stringify({ projectId, previewVersion });
  return `<script type="application/json" data-harness-meta>${meta}</script>`;
};

const buildRuntimeBridgeScript = (): string => {
  // Body is serialized as an IIFE so it cannot collide with project globals. The helper
  // implementations mirror `dedupeAndCapEntries` / `truncateMessage` in previewRuntimeDiagnostics.ts.
  const body = `
    (function () {
      if (typeof window === 'undefined' || window.__harnessRuntimeBridgeInstalled__) {
        return;
      }
      try {
        Object.defineProperty(window, '__harnessRuntimeBridgeInstalled__', {
          value: true,
          configurable: false,
          writable: false,
        });
      } catch (_) {
        window.__harnessRuntimeBridgeInstalled__ = true;
      }

      var MAX_ENTRIES = 50;
      var MAX_MESSAGE = 500;
      var FLUSH_THROTTLE = 250;

      function readMeta() {
        try {
          var node = document.currentScript
            ? document.currentScript.previousElementSibling
            : null;
          if (!node) {
            var nodes = document.querySelectorAll('script[data-harness-meta]');
            node = nodes.length > 0 ? nodes[nodes.length - 1] : null;
          }
          if (!node || !node.textContent) {
            return null;
          }
          return JSON.parse(node.textContent);
        } catch (_) {
          return null;
        }
      }

      var meta = readMeta();
      if (!meta || typeof meta.projectId !== 'string' || typeof meta.previewVersion !== 'number') {
        return;
      }

      var projectId = meta.projectId;
      var previewVersion = meta.previewVersion;
      var entries = [];
      var seen = {};
      var flushScheduled = false;
      var pendingFlush = null;

      function truncate(msg, max) {
        if (typeof msg !== 'string') {
          msg = String(msg == null ? '' : msg);
        }
        var limit = typeof max === 'number' ? max : MAX_MESSAGE;
        if (msg.length <= limit) {
          return msg;
        }
        return msg.slice(0, limit) + '\\u2026';
      }

      function addEntry(kind, message, extras) {
        if (typeof message !== 'string' || message.length === 0) {
          return;
        }
        var signature = kind + '::' + message;
        if (Object.prototype.hasOwnProperty.call(seen, signature)) {
          return;
        }
        seen[signature] = true;
        var entry = { kind: kind, message: truncate(message), timestamp: Date.now() };
        if (extras) {
          if (extras.stack) { entry.stack = truncate(extras.stack, 1000); }
          if (extras.source) { entry.source = extras.source; }
          if (typeof extras.lineno === 'number') { entry.lineno = extras.lineno; }
          if (typeof extras.colno === 'number') { entry.colno = extras.colno; }
        }
        entries.push(entry);
        if (entries.length > MAX_ENTRIES) {
          entries = entries.slice(entries.length - MAX_ENTRIES);
        }
      }

      function postToParent(type, payload) {
        try {
          var msg = Object.assign(
            { type: type, projectId: projectId, previewVersion: previewVersion },
            payload || {}
          );
          if (window.parent && typeof window.parent.postMessage === 'function') {
            window.parent.postMessage(msg, '*');
          }
        } catch (_) {
          /* swallow — never let telemetry break the page */
        }
      }

      function flushErrors(force) {
        if (!force && entries.length === 0) {
          return;
        }
        if (!force && flushScheduled) {
          return;
        }
        if (!force && pendingFlush) {
          return;
        }
        if (force) {
          if (pendingFlush) {
            clearTimeout(pendingFlush);
            pendingFlush = null;
          }
          flushScheduled = false;
          postToParent('runtime-errors', { errors: entries.slice() });
          return;
        }
        flushScheduled = true;
        pendingFlush = setTimeout(function () {
          pendingFlush = null;
          flushScheduled = false;
          postToParent('runtime-errors', { errors: entries.slice() });
        }, FLUSH_THROTTLE);
      }

      window.addEventListener('error', function (event) {
        var message = (event && (event.message || event.error && event.error.message)) || 'error';
        addEntry('error', message, {
          stack: event && event.error && event.error.stack,
          source: event && event.filename,
          lineno: event && event.lineno,
          colno: event && event.colno,
        });
        flushErrors(false);
      });

      window.addEventListener('unhandledrejection', function (event) {
        var reason = event && event.reason;
        var message = 'object' === typeof reason && reason !== null
          ? (reason.message || String(reason))
          : String(reason == null ? '' : reason);
        addEntry('unhandledrejection', message, {
          stack: reason && reason.stack,
        });
        flushErrors(false);
      });

      var origConsoleError = console.error ? console.error.bind(console) : null;
      var origConsoleWarn = console.warn ? console.warn.bind(console) : null;
      if (typeof console.error === 'function') {
        console.error = function () {
          try {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
              parts.push(typeof arguments[i] === 'object' ? safeStringify(arguments[i]) : String(arguments[i]));
            }
            addEntry('console_error', parts.join(' '));
            flushErrors(false);
          } catch (_) { /* ignore */ }
          if (origConsoleError) {
            origConsoleError.apply(console, arguments);
          }
        };
      }
      if (typeof console.warn === 'function') {
        console.warn = function () {
          try {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
              parts.push(typeof arguments[i] === 'object' ? safeStringify(arguments[i]) : String(arguments[i]));
            }
            addEntry('console_warn', parts.join(' '));
            flushErrors(false);
          } catch (_) { /* ignore */ }
          if (origConsoleWarn) {
            origConsoleWarn.apply(console, arguments);
          }
        };
      }

      function safeStringify(value) {
        try {
          return JSON.stringify(value);
        } catch (_) {
          return String(value);
        }
      }

      window.addEventListener('load', function () {
        postToParent('ready', {});
      });

      function finalFlush() {
        flushErrors(true);
      }
      window.addEventListener('pagehide', finalFlush);
      window.addEventListener('beforeunload', finalFlush);
    })();
  `
    .replace(/\n\s*/g, '\n')
    .trim();

  return `<script data-harness-bridge>${body}</script>`;
};

/**
 * Inject the G1 runtime bridge (meta + bridge script) into the artifact HTML immediately
 * before `</body>` (or append to the end of the document if no body close tag is present).
 * No-op when `previewReady` is false.
 */
const injectRuntimeBridge = (html: string, projectId: string, previewVersion: number): string => {
  const meta = buildHarnessMetaScript(projectId, previewVersion);
  const bridge = buildRuntimeBridgeScript();
  const injection = `${meta}\n${bridge}`;

  const bodyClose = /<\/body>/i.exec(html);
  if (bodyClose) {
    return `${html.slice(0, bodyClose.index)}${injection}\n${html.slice(bodyClose.index)}`;
  }
  const htmlClose = /<\/html>/i.exec(html);
  if (htmlClose) {
    return `${html.slice(0, htmlClose.index)}${injection}\n${html.slice(htmlClose.index)}`;
  }
  return `${html}\n${injection}`;
};

class HtmlPreviewService {
  private previewUrls = new Map<string, string>();

  private inlineCss(
    html: string,
    entryFile: string,
    fileMap: Map<string, HtmlProjectFile>,
    warnings: string[],
    missing: Set<string>,
  ): string {
    const linkPattern = /<link([^>]*?)href=['"]([^'"]+)['"]([^>]*?)>/gi;

    return html.replace(linkPattern, (fullMatch, beforeHref, href, afterHref) => {
      const relAttr = `${beforeHref} ${afterHref}`;
      if (!/rel=['"]?stylesheet['"]?/i.test(relAttr)) {
        return fullMatch;
      }

      if (EXTERNAL_REF_PATTERN.test(href)) {
        warnings.push(`保留外部樣式資源：${href}`);
        return fullMatch;
      }

      const resolvedPath = resolveRelativePath(entryFile, href);
      const cssFile = fileMap.get(resolvedPath);
      if (!cssFile) {
        missing.add(resolvedPath);
        return fullMatch;
      }

      return `<style data-project-path="${resolvedPath}">\n${cssFile.content}\n</style>`;
    });
  }

  private inlineScripts(
    html: string,
    entryFile: string,
    fileMap: Map<string, HtmlProjectFile>,
    warnings: string[],
    missing: Set<string>,
  ): string {
    const scriptPattern = /<script([^>]*?)src=['"]([^'"]+)['"]([^>]*)><\/script>/gi;

    return html.replace(scriptPattern, (fullMatch, beforeSrc, src, afterSrc) => {
      if (EXTERNAL_REF_PATTERN.test(src)) {
        warnings.push(`保留外部腳本資源：${src}`);
        return fullMatch;
      }

      const resolvedPath = resolveRelativePath(entryFile, src);
      const scriptFile = fileMap.get(resolvedPath);
      if (!scriptFile) {
        missing.add(resolvedPath);
        return fullMatch;
      }

      return `<script${beforeSrc}${afterSrc} data-project-path="${resolvedPath}">\n${scriptFile.content}\n</script>`;
    });
  }

  private buildArtifact(
    project: HtmlProject,
    files: HtmlProjectFile[],
  ): HtmlProjectPreviewArtifact {
    const fileMap = new Map(files.map(file => [file.path, file]));
    const entryFile = fileMap.get(project.entryFile);
    const warnings: string[] = [];
    const missing = new Set<string>();
    const generatedAt = Date.now();

    if (!entryFile) {
      return {
        projectId: project.id,
        previewVersion: project.previewVersion,
        entryFile: project.entryFile,
        previewReady: false,
        previewUrlType: 'blob',
        html: '',
        warnings,
        error: `Entrypoint ${project.entryFile} 不存在。`,
        diagnostics: buildMissingEntrypointDiagnostics(project.entryFile),
        generatedAt,
      };
    }

    let html = entryFile.content;
    html = this.inlineCss(html, entryFile.path, fileMap, warnings, missing);
    html = this.inlineScripts(html, entryFile.path, fileMap, warnings, missing);

    if (missing.size > 0) {
      const missingPaths = Array.from(missing);
      return {
        projectId: project.id,
        previewVersion: project.previewVersion,
        entryFile: project.entryFile,
        previewReady: false,
        previewUrlType: 'blob',
        html,
        warnings,
        error: `缺少預覽所需檔案：${missingPaths.join(', ')}`,
        diagnostics: buildMissingReferenceDiagnostics(missingPaths, warnings),
        generatedAt,
      };
    }

    const bridgedHtml = injectRuntimeBridge(html, project.id, project.previewVersion);

    return {
      projectId: project.id,
      previewVersion: project.previewVersion,
      entryFile: project.entryFile,
      previewReady: true,
      previewUrlType: 'blob',
      html: bridgedHtml,
      warnings,
      error: null,
      diagnostics: buildReadyDiagnostics(warnings),
      generatedAt,
    };
  }

  async buildPreviewArtifact(projectId: string): Promise<HtmlProjectPreviewArtifact> {
    const project = await htmlProjectStore.getProject(projectId);
    if (!project) {
      throw new Error(`HTML project ${projectId} not found.`);
    }

    const descriptors = await htmlProjectStore.listFiles(projectId);
    const files = await Promise.all(
      descriptors.map(async descriptor => htmlProjectStore.readFile(projectId, descriptor.path)),
    );

    return this.buildArtifact(
      project,
      files.filter((file): file is HtmlProjectFile => Boolean(file)),
    );
  }

  revokePreviewUrl(projectId: string): void {
    const currentUrl = this.previewUrls.get(projectId);
    if (currentUrl && currentUrl.startsWith('blob:')) {
      URL.revokeObjectURL(currentUrl);
    }
    this.previewUrls.delete(projectId);
  }

  async createPreviewUrl(projectId: string): Promise<HtmlProjectPreviewArtifact> {
    const artifact = await this.buildPreviewArtifact(projectId);
    if (!artifact.previewReady) {
      this.revokePreviewUrl(projectId);
      return artifact;
    }

    this.revokePreviewUrl(projectId);

    let urlType: HtmlProjectPreviewUrlType = 'blob';
    let url: string;

    if (
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function' &&
      typeof globalThis.Blob === 'function'
    ) {
      url = URL.createObjectURL(new globalThis.Blob([artifact.html], { type: 'text/html' }));
    } else {
      urlType = 'data';
      url = toDataUrl(artifact.html);
    }

    this.previewUrls.set(projectId, url);

    return {
      ...artifact,
      previewUrlType: urlType,
      url,
    };
  }

  async resolveProjectForPreview(projectId: string): Promise<HtmlProjectPreviewArtifact> {
    return this.createPreviewUrl(projectId);
  }
}

export const htmlPreviewService = new HtmlPreviewService();
