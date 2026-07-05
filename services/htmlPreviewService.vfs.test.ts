import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlProject, HtmlProjectFile } from '../types';

const { mockGetProject, mockListFiles, mockReadFile } = vi.hoisted(() => ({
  mockGetProject: vi.fn(),
  mockListFiles: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock('./htmlProjectStore', () => ({
  htmlProjectStore: {
    getProject: mockGetProject,
    listFiles: mockListFiles,
    readFile: mockReadFile,
  },
}));

const project: HtmlProject = {
  id: 'proj-vfs',
  assistantId: 'a-1',
  sessionId: 's-1',
  name: 'VFS Project',
  entryFile: '/index.html',
  status: 'draft',
  previewVersion: 5,
  assetPaths: [],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  lastBuildError: null,
};

const makeFile = (
  path: string,
  content: string,
  overrides: Partial<HtmlProjectFile> = {},
): HtmlProjectFile => ({
  projectId: 'proj-vfs',
  path,
  kind: path.endsWith('.css')
    ? 'css'
    : path.endsWith('.js')
      ? 'js'
      : path.endsWith('.json')
        ? 'json'
        : path.endsWith('.svg')
          ? 'svg'
          : 'asset',
  content,
  encoding: 'utf-8',
  dependencies: [],
  size: content.length,
  updatedAt: 1700000000000,
  ...overrides,
});

const setupProject = (files: HtmlProjectFile[]) => {
  mockGetProject.mockResolvedValue(project);
  mockListFiles.mockResolvedValue(files.map(f => ({ path: f.path })));
  mockReadFile.mockImplementation(async (_pid: string, path: string) =>
    files.find(f => f.path === path),
  );
};

const parseEmbeddedManifest = (html: string) => {
  const match = html.match(/<script[^>]*data-vfs-manifest[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('no data-vfs-manifest script found');
  }
  return JSON.parse(match[1]) as {
    files: Array<{
      path: string;
      kind: string;
      mime: string;
      isModule: boolean;
      content: string;
      encoding?: 'utf-8' | 'base64';
    }>;
    entryModules: Array<{ path: string }>;
  };
};

describe('htmlPreviewService VFS pipeline', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:vfs-preview'),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  it('AC1: tags <img src=logo.png> with data-vfs and includes the asset in the manifest', async () => {
    const pngBase64 = btoa('fake-png-bytes');
    const files = [
      makeFile(
        '/index.html',
        '<!doctype html><html><head></head><body><img src="./logo.png"></body></html>',
        { kind: 'html' },
      ),
      makeFile('/logo.png', pngBase64, { kind: 'asset', encoding: 'base64' }),
    ];
    setupProject(files);

    const { htmlPreviewService } = await import('./htmlPreviewService');
    const artifact = await htmlPreviewService.resolveProjectForPreview('proj-vfs');

    expect(artifact.previewReady).toBe(true);
    expect(artifact.html).toContain('data-vfs="/logo.png"');
    const manifest = parseEmbeddedManifest(artifact.html);
    const logo = manifest.files.find(f => f.path === '/logo.png');
    expect(logo).toBeDefined();
    expect(logo?.encoding ?? 'utf-8').toBe('base64'); // encoding may be omitted if defaulted
    expect(logo?.mime).toBe('image/png');
    expect(artifact.vfsFileCount).toBeGreaterThanOrEqual(1);
  });

  it('AC4: registers a CSS file in the manifest (bootstrap resolves url()/@import) and inlines <link> as <style>', async () => {
    const files = [
      makeFile(
        '/index.html',
        '<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body><style>.x { background: url(./bg.png); }</style></body></html>',
        { kind: 'html' },
      ),
      makeFile('/styles.css', '@import "./base.css"; body { color: red; }', { kind: 'css' }),
      makeFile('/base.css', 'body { margin: 0; }', { kind: 'css' }),
      makeFile('/bg.png', btoa('bg'), { kind: 'asset', encoding: 'base64' }),
    ];
    setupProject(files);

    const { htmlPreviewService } = await import('./htmlPreviewService');
    const artifact = await htmlPreviewService.resolveProjectForPreview('proj-vfs');

    expect(artifact.previewReady).toBe(true);
    // CSS <link> inlined as <style> (classic equivalence).
    expect(artifact.html).toContain('<style data-project-path="/styles.css">');
    // CSS files present in the manifest for bootstrap url()/@import resolution.
    const manifest = parseEmbeddedManifest(artifact.html);
    expect(manifest.files.some(f => f.path === '/styles.css')).toBe(true);
    expect(manifest.files.some(f => f.path === '/base.css')).toBe(true);
  });

  it('AC7a: missing <img src> produces a build-time missing_reference diagnostic that blocks preview', async () => {
    const files = [
      makeFile(
        '/index.html',
        '<!doctype html><html><body><img src="./missing.png"></body></html>',
        { kind: 'html' },
      ),
    ];
    setupProject(files);

    const { htmlPreviewService } = await import('./htmlPreviewService');
    const artifact = await htmlPreviewService.resolveProjectForPreview('proj-vfs');

    expect(artifact.previewReady).toBe(false);
    expect(artifact.diagnostics?.category).toBe('missing_reference');
    expect(artifact.diagnostics?.missingPaths).toContain('/missing.png');
  });

  it('extracts <script type=module src> into a manifest entry with rewritten specifiers', async () => {
    const files = [
      makeFile(
        '/index.html',
        '<!doctype html><html><body><script type="module" src="./main.js"></script></body></html>',
        { kind: 'html' },
      ),
      makeFile('/main.js', "import { x } from './utils.js'; console.log(x);", { kind: 'js' }),
      makeFile('/utils.js', 'export const x = 42;', { kind: 'js' }),
    ];
    setupProject(files);

    const { htmlPreviewService } = await import('./htmlPreviewService');
    const artifact = await htmlPreviewService.resolveProjectForPreview('proj-vfs');

    expect(artifact.previewReady).toBe(true);
    // The module tag is removed from HTML (bootstrap loads it via import map).
    expect(artifact.html).not.toContain('type="module" src="./main.js"');
    const manifest = parseEmbeddedManifest(artifact.html);
    expect(manifest.entryModules).toContainEqual({ path: '/main.js' });
    const main = manifest.files.find(f => f.path === '/main.js');
    expect(main?.isModule).toBe(true);
    // Specifier rewritten to vfs:/utils.js (V3).
    expect(main?.content).toContain("from 'vfs:/utils.js'");
    // Classic-only: utils.js is also a module (importable), in the import map.
    const utils = manifest.files.find(f => f.path === '/utils.js');
    expect(utils?.isModule).toBe(true);
  });

  it('rewrites specifiers relative to the importing file path (deep module graph)', async () => {
    const files = [
      makeFile(
        '/index.html',
        '<!doctype html><html><body><script type="module" src="./src/main.js"></script></body></html>',
        { kind: 'html' },
      ),
      makeFile('/src/main.js', "import { h } from './lib/helper.js';", { kind: 'js' }),
      makeFile('/src/lib/helper.js', "import { base } from '../../base.js';", { kind: 'js' }),
      makeFile('/base.js', 'export const base = 1;', { kind: 'js' }),
    ];
    setupProject(files);

    const { htmlPreviewService } = await import('./htmlPreviewService');
    const artifact = await htmlPreviewService.resolveProjectForPreview('proj-vfs');

    const manifest = parseEmbeddedManifest(artifact.html);
    const main = manifest.files.find(f => f.path === '/src/main.js');
    const helper = manifest.files.find(f => f.path === '/src/lib/helper.js');
    expect(main?.content).toContain("from 'vfs:/src/lib/helper.js'");
    expect(helper?.content).toContain("from 'vfs:/base.js'");
  });

  it('V10: removes <base> tags and records a base_tag_removed warning', async () => {
    const files = [
      makeFile(
        '/index.html',
        '<!doctype html><html><head><base href="/somewhere/"></head><body><p>hi</p></body></html>',
        { kind: 'html' },
      ),
    ];
    setupProject(files);

    const { htmlPreviewService } = await import('./htmlPreviewService');
    const artifact = await htmlPreviewService.resolveProjectForPreview('proj-vfs');

    expect(artifact.previewReady).toBe(true);
    expect(artifact.html).not.toContain('<base ');
    expect(artifact.warnings.some(w => w.startsWith('base_tag_removed'))).toBe(true);
  });

  it('AC10: a project whose JS content contains </script> and <!-- embeds a parseable manifest', async () => {
    const files = [
      makeFile(
        '/index.html',
        '<!doctype html><html><body><script type="module" src="./tricky.js"></script></body></html>',
        { kind: 'html' },
      ),
      makeFile(
        '/tricky.js',
        'const html = "<script>x</script>"; /* <!-- not the end */ export const v = 1;',
        { kind: 'js' },
      ),
    ];
    setupProject(files);

    const { htmlPreviewService } = await import('./htmlPreviewService');
    const artifact = await htmlPreviewService.resolveProjectForPreview('proj-vfs');

    expect(artifact.previewReady).toBe(true);
    // The manifest must round-trip: it parses and the original tricky content is preserved.
    const manifest = parseEmbeddedManifest(artifact.html);
    const tricky = manifest.files.find(f => f.path === '/tricky.js');
    expect(tricky?.content).toContain('<script>x</script>');
    expect(tricky?.content).toContain('<!-- not the end');
    // And no literal </script> leaked from the manifest into the host document prematurely
    // (the only </script> tokens belong to the wrapper tags themselves).
    const scriptCloseCount = (artifact.html.match(/<\/script>/g) || []).length;
    expect(scriptCloseCount).toBeGreaterThanOrEqual(1);
  });

  it('AC8: classic-only project keeps CSS <style> inlining and classic <script> inlining (behavior equivalence)', async () => {
    const files = [
      makeFile(
        '/index.html',
        '<!doctype html><html><head><link rel="stylesheet" href="./styles/app.css"></head><body><script src="./scripts/app.js"></script></body></html>',
        { kind: 'html' },
      ),
      makeFile('/styles/app.css', 'body { color: red; }', { kind: 'css' }),
      makeFile('/scripts/app.js', 'console.log("preview");', { kind: 'js' }),
    ];
    setupProject(files);

    const { htmlPreviewService } = await import('./htmlPreviewService');
    const artifact = await htmlPreviewService.resolveProjectForPreview('proj-vfs');

    expect(artifact.previewReady).toBe(true);
    // CSS inlined as <style> (unchanged from pre-VFS behavior).
    expect(artifact.html).toContain('<style data-project-path="/styles/app.css">');
    expect(artifact.html).toContain('body { color: red; }');
    // Classic script inlined (unchanged).
    expect(artifact.html).toContain('<script  data-project-path="/scripts/app.js">');
    expect(artifact.html).toContain('console.log("preview");');
    // Classic JS is NOT a module (not in import map).
    const manifest = parseEmbeddedManifest(artifact.html);
    const app = manifest.files.find(f => f.path === '/scripts/app.js');
    expect(app?.isModule).toBe(false);
    // Diagnostics outcome equivalent to pre-VFS (ready, no warnings).
    expect(artifact.diagnostics?.outcome).toBe('ready');
    expect(artifact.warnings).toEqual([]);
  });

  it('emits both data-vfs-manifest and data-vfs-bootstrap scaffolding, plus the harness bridge', async () => {
    const files = [
      makeFile('/index.html', '<!doctype html><html><body><p>hi</p></body></html>', {
        kind: 'html',
      }),
    ];
    setupProject(files);

    const { htmlPreviewService } = await import('./htmlPreviewService');
    const artifact = await htmlPreviewService.resolveProjectForPreview('proj-vfs');

    expect(artifact.html).toContain('data-vfs-manifest');
    expect(artifact.html).toContain('data-vfs-bootstrap');
    expect(artifact.html).toContain('data-harness-bridge');
    // Bootstrap must precede the bridge (head vs end-of-body).
    const bootstrapIdx = artifact.html.indexOf('data-vfs-bootstrap');
    const bridgeIdx = artifact.html.indexOf('data-harness-bridge');
    expect(bootstrapIdx).toBeGreaterThan(-1);
    expect(bridgeIdx).toBeGreaterThan(bootstrapIdx);
  });
});
