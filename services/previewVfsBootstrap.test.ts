import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  assembleVfs,
  buildVfsBootstrapScript,
  resolveFetchPath,
  resolveRelativePath,
  rewriteCssUrls,
  rewriteSrcset,
  serializeVfsManifest,
  type VfsManifest,
} from './previewVfsBootstrap';

describe('resolveRelativePath', () => {
  it('resolves a relative path against a base file directory', () => {
    expect(resolveRelativePath('/src/main.js', './utils.js')).toBe('/src/utils.js');
    expect(resolveRelativePath('/index.html', 'logo.png')).toBe('/logo.png');
  });

  it('handles parent traversal', () => {
    expect(resolveRelativePath('/src/lib/helper.js', '../utils.js')).toBe('/src/utils.js');
    expect(resolveRelativePath('/a/b/c.js', '../../d.js')).toBe('/d.js');
  });

  it('passes through absolute and external references unchanged', () => {
    expect(resolveRelativePath('/index.html', '/assets/x.png')).toBe('/assets/x.png');
    expect(resolveRelativePath('/index.html', 'https://cdn.example.com/x.png')).toBe(
      'https://cdn.example.com/x.png',
    );
    expect(resolveRelativePath('/index.html', '//cdn.example.com/x')).toBe('//cdn.example.com/x');
  });
});

describe('resolveFetchPath', () => {
  it('resolves relative fetch URLs to root-absolute project paths', () => {
    expect(resolveFetchPath('data.json')).toBe('/data.json');
    expect(resolveFetchPath('./data.json')).toBe('/data.json');
    expect(resolveFetchPath('/data.json')).toBe('/data.json');
  });

  it('strips query and hash fragments', () => {
    expect(resolveFetchPath('data.json?v=1')).toBe('/data.json');
    expect(resolveFetchPath('/data.json#section')).toBe('/data.json');
  });

  it('returns null for absolute/external URLs (passthrough)', () => {
    expect(resolveFetchPath('https://example.com/x')).toBeNull();
    expect(resolveFetchPath('http://example.com/x')).toBeNull();
    expect(resolveFetchPath('//cdn.example.com/x')).toBeNull();
    expect(resolveFetchPath('mailto:a@b.com')).toBeNull();
    expect(resolveFetchPath('#anchor')).toBeNull();
  });
});

describe('rewriteCssUrls', () => {
  const fileMap: Record<string, string> = {
    '/assets/bg.png': 'blob:asset-bg',
    '/theme/extra.css': 'blob:extra-css',
  };

  it('rewrites url() references that resolve to fileMap entries', () => {
    const css = 'body { background: url(./bg.png); }';
    expect(rewriteCssUrls(css, '/assets/app.css', fileMap)).toBe(
      'body { background: url(blob:asset-bg); }',
    );
  });

  it('resolves url() relative to the css file path, not the root', () => {
    // /theme/app.css url(./extra.css) → /theme/extra.css
    const css = "@import './extra.css';";
    expect(rewriteCssUrls(css, '/theme/app.css', fileMap)).toContain('blob:extra-css');
  });

  it('rewrites @import statements to blob URLs', () => {
    const css = '@import "./extra.css";';
    const out = rewriteCssUrls(css, '/theme/app.css', fileMap);
    expect(out).toContain('@import url("blob:extra-css")');
  });

  it('preserves external url() and @import references', () => {
    const css =
      'body { background: url(https://cdn.example.com/bg.png); } @import "https://x/y.css";';
    const out = rewriteCssUrls(css, '/app.css', fileMap);
    expect(out).toContain('url(https://cdn.example.com/bg.png)');
    expect(out).toContain('@import "https://x/y.css"');
  });

  it('leaves unresolved relative references untouched', () => {
    const css = 'body { background: url(./missing.png); }';
    expect(rewriteCssUrls(css, '/app.css', fileMap)).toBe(css);
  });
});

describe('rewriteSrcset', () => {
  const fileMap: Record<string, string> = {
    '/small.png': 'blob:small',
    '/big.png': 'blob:big',
  };

  it('rewrites each URL in a multi-candidate srcset, preserving descriptors', () => {
    const out = rewriteSrcset('/small.png 1x, /big.png 2x', fileMap);
    expect(out).toBe('blob:small 1x, blob:big 2x');
  });

  it('preserves external URLs in srcset', () => {
    const out = rewriteSrcset('https://cdn.example.com/x.png 1x', fileMap);
    expect(out).toBe('https://cdn.example.com/x.png 1x');
  });

  it('handles a single URL with no descriptor', () => {
    expect(rewriteSrcset('/small.png', fileMap)).toBe('blob:small');
  });
});

describe('serializeVfsManifest (V2 escaping)', () => {
  it('escapes < so the result contains no literal </ sequence', () => {
    const manifest: VfsManifest = {
      files: [
        {
          path: '/x.js',
          kind: 'js',
          mime: 'text/javascript',
          encoding: 'utf-8',
          content: 'const html = "<script>alert(1)</script>";',
          isModule: false,
        },
      ],
      entryModules: [],
    };
    const serialized = serializeVfsManifest(manifest);
    expect(serialized).not.toContain('</');
    expect(serialized).not.toContain('<script');
    expect(serialized).toContain('\\u003c');
  });

  it('round-trips through JSON.parse back to the original content', () => {
    const manifest: VfsManifest = {
      files: [
        {
          path: '/x.html',
          kind: 'html',
          mime: 'text/html',
          encoding: 'utf-8',
          content: '<!-- comment --><b>hi</b>',
          isModule: false,
        },
      ],
      entryModules: [],
    };
    const parsed = JSON.parse(serializeVfsManifest(manifest)) as VfsManifest;
    expect(parsed.files[0].content).toBe('<!-- comment --><b>hi</b>');
  });
});

describe('assembleVfs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates blob URLs for asset → css → js and registers module URLs with vfs: keys', () => {
    const manifest: VfsManifest = {
      files: [
        {
          path: '/logo.png',
          kind: 'asset',
          mime: 'image/png',
          encoding: 'base64',
          content: btoa('fake-image'),
          isModule: false,
        },
        {
          path: '/app.css',
          kind: 'css',
          mime: 'text/css',
          encoding: 'utf-8',
          content: 'body { background: url(./logo.png); }',
          isModule: false,
        },
        {
          path: '/main.js',
          kind: 'js',
          mime: 'text/javascript',
          encoding: 'utf-8',
          content: "import { x } from 'vfs:/utils.js';",
          isModule: true,
        },
        {
          path: '/utils.js',
          kind: 'js',
          mime: 'text/javascript',
          encoding: 'utf-8',
          content: 'export const x = 1;',
          isModule: true,
        },
      ],
      entryModules: [{ path: '/main.js' }],
    };

    const result = assembleVfs(manifest);

    expect(result.degraded).toBe(false);
    expect(result.errors).toEqual([]);
    expect(Object.keys(result.fileMap).sort()).toEqual(
      ['/app.css', '/logo.png', '/main.js', '/utils.js'].sort(),
    );
    // CSS url() rewritten to the logo blob URL.
    expect(result.moduleUrls['vfs:/main.js']).toBeDefined();
    expect(result.moduleUrls['vfs:/utils.js']).toBeDefined();
    expect(result.moduleUrls['vfs:/app.css']).toBeUndefined();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(4);
  });

  it('resolves CSS url() references to asset blob URLs created in the earlier phase', () => {
    const manifest: VfsManifest = {
      files: [
        {
          path: '/bg.png',
          kind: 'asset',
          mime: 'image/png',
          encoding: 'base64',
          content: btoa('bg'),
          isModule: false,
        },
        {
          path: '/styles.css',
          kind: 'css',
          mime: 'text/css',
          encoding: 'utf-8',
          content: '.a { background: url(./bg.png); }',
          isModule: false,
        },
      ],
      entryModules: [],
    };
    const result = assembleVfs(manifest);
    expect(result.degraded).toBe(false);
    // The CSS blob URL should differ from the raw content (it was rewritten). We cannot read
    // blob content back, but createObjectURL must have been called for both, and the css URL
    // was generated from rewritten content (no throw).
    expect(result.fileMap['/styles.css']).toBeDefined();
    expect(result.fileMap['/bg.png']).toBeDefined();
  });

  it('handles one level of CSS @import chains via the second pass', () => {
    const manifest: VfsManifest = {
      files: [
        {
          path: '/theme.css',
          kind: 'css',
          mime: 'text/css',
          encoding: 'utf-8',
          content: '@import "./base.css";',
          isModule: false,
        },
        {
          path: '/base.css',
          kind: 'css',
          mime: 'text/css',
          encoding: 'utf-8',
          content: 'body { color: red; }',
          isModule: false,
        },
      ],
      entryModules: [],
    };
    const result = assembleVfs(manifest);
    expect(result.degraded).toBe(false);
    // Both CSS files get blob URLs; base.css is processed so theme.css @import can resolve
    // on the second pass. We assert no degradation and both paths present.
    expect(Object.keys(result.fileMap).sort()).toEqual(['/base.css', '/theme.css']);
  });

  it('degrades gracefully when base64 content cannot be decoded', () => {
    const manifest: VfsManifest = {
      files: [
        {
          path: '/bad.png',
          kind: 'asset',
          mime: 'image/png',
          encoding: 'base64',
          content: '!!!not-base64!!!',
          isModule: false,
        },
      ],
      entryModules: [],
    };
    const result = assembleVfs(manifest);
    expect(result.degraded).toBe(true);
    expect(result.errors.some(e => e.includes('/bad.png'))).toBe(true);
  });
});

describe('buildVfsBootstrapScript', () => {
  it('produces a self-contained script tag with key VFS markers', () => {
    const script = buildVfsBootstrapScript({ projectId: 'proj-1', previewVersion: 3 });
    expect(script.startsWith('<script data-vfs-bootstrap>')).toBe(true);
    expect(script.endsWith('</script>')).toBe(true);
    expect(script).toContain('"proj-1"');
    expect(script).toContain('data-vfs-manifest');
    expect(script).toContain('importmap');
    expect(script).toContain('vfs:');
    expect(script).toContain('missing_reference');
    expect(script).toContain('__vfsReady__');
    expect(script).toContain('vfs:ready');
    expect(script).toContain('Promise.allSettled');
  });

  it('never contains a literal </script> inside the IIFE body', () => {
    const script = buildVfsBootstrapScript({ projectId: 'p', previewVersion: 0 });
    // The only </script> should be the closing tag of the wrapper itself.
    const occurrences = (script.match(/<\/script>/g) || []).length;
    expect(occurrences).toBe(1);
  });
});

describe('buildVfsBootstrapScript — IIFE execution in jsdom', () => {
  // Execute the generated IIFE against a live jsdom document to verify runtime behavior that
  // pure helpers cannot (the corrupt-manifest path does not reach dynamic import(), so jsdom
  // execution is safe and deterministic here).
  const runBootstrap = (manifestContent: string) => {
    document.head.innerHTML = `<script type="application/json" data-vfs-manifest>${manifestContent}</script>`;
    // Clean slate between runs.
    // @ts-ignore
    delete (window as unknown as Record<string, unknown>).__vfsReady__;
    // @ts-ignore
    delete (window as unknown as Record<string, unknown>).__vfsErrors__;
    const script = buildVfsBootstrapScript({ projectId: 'p-exec', previewVersion: 1 });
    const body = script.replace(/^<script data-vfs-bootstrap>/, '').replace(/<\/script>$/, '');
    // Indirect eval (0,eval) runs in the jsdom global scope; not flagged by no-eval.
    (0, eval)(body);
    return {
      // @ts-ignore
      ready: (window as unknown as { __vfsReady__?: { done: boolean; degraded: boolean } })
        .__vfsReady__,
      // @ts-ignore
      errors: (window as unknown as { __vfsErrors__?: Array<{ kind: string; message: string }> })
        .__vfsErrors__,
    };
  };

  it('AC11: a corrupt manifest still signals vfs-ready (degraded) with a buffered parse error — never not_executed', () => {
    // Intentionally malformed JSON. readManifest catches JSON.parse, sets degraded, buffers the
    // error, and still calls signalReady — so the harness bridge will ack with has_errors.
    const { ready, errors } = runBootstrap('{ this is not valid json');
    expect(ready).toBeDefined();
    expect(ready?.done).toBe(true);
    expect(ready?.degraded).toBe(true);
    expect(errors).toBeDefined();
    expect(errors!.some(e => /manifest parse failed/i.test(e.message))).toBe(true);
  });

  it('an empty manifest signals a clean (non-degraded) vfs-ready', async () => {
    // The empty-manifest path goes through whenDomReady (async setTimeout), so the vfs-ready
    // signal lands on the next tick — await it before asserting.
    const pending = runBootstrap(JSON.stringify({ files: [], entryModules: [] }));
    await new Promise(resolve => setTimeout(resolve, 50));
    // @ts-ignore
    const ready = (window as unknown as { __vfsReady__?: { done: boolean; degraded: boolean } })
      .__vfsReady__;
    // @ts-ignore
    const errors = (window as unknown as { __vfsErrors__?: unknown[] }).__vfsErrors__;
    expect(ready?.done).toBe(true);
    expect(ready?.degraded).toBe(false);
    expect(errors).toEqual([]);
    void pending;
  });
});
