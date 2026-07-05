import { expect, test } from '@playwright/test';
import {
  buildVfsBootstrapScript,
  serializeVfsManifest,
  type VfsManifest,
} from '../../services/previewVfsBootstrap';
import { rewriteModuleSpecifiers } from '../../services/previewVfsRewriter';

/**
 * VFS sandbox end-to-end (AC2/AC1/AC3, V5/V9). Builds a real preview artifact — using the actual
 * buildVfsBootstrapScript + serializeVfsManifest + rewriteModuleSpecifiers — for a three-file ES
 * module project that includes a circular dependency, an image asset, and a fetch() of a project
 * JSON file; loads it in a real browser (chromium + webkit) and asserts the module graph executed,
 * the image rendered, and fetch returned project content. This validates the import-map + vfs:/
 * specifier resolution and the fetch/data-vfs patches that pure unit tests cannot.
 */

// 1x1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const buildArtifactHtml = (): string => {
  const mainRaw = `import { x } from './utils.js';
import { h } from './lib/helper.js';
document.getElementById('out').textContent = 'x=' + x + ' h=' + h();
fetch('./data.json').then(r => r.json()).then(d => {
  document.getElementById('fetch-out').textContent = d.value;
});`;
  const utilsRaw = `import { h } from './lib/helper.js';
export const x = 21;`;
  const helperRaw = `import { x } from '../utils.js';
export const h = () => x * 2;`;

  const main = rewriteModuleSpecifiers(mainRaw, '/main.js').code;
  const utils = rewriteModuleSpecifiers(utilsRaw, '/utils.js').code;
  const helper = rewriteModuleSpecifiers(helperRaw, '/lib/helper.js').code;

  const manifest: VfsManifest = {
    files: [
      {
        path: '/main.js',
        kind: 'js',
        mime: 'text/javascript',
        encoding: 'utf-8',
        content: main,
        isModule: true,
      },
      {
        path: '/utils.js',
        kind: 'js',
        mime: 'text/javascript',
        encoding: 'utf-8',
        content: utils,
        isModule: true,
      },
      {
        path: '/lib/helper.js',
        kind: 'js',
        mime: 'text/javascript',
        encoding: 'utf-8',
        content: helper,
        isModule: true,
      },
      {
        path: '/data.json',
        kind: 'json',
        mime: 'application/json',
        encoding: 'utf-8',
        content: '{"value":"hello-vfs"}',
        isModule: false,
      },
      {
        path: '/logo.png',
        kind: 'asset',
        mime: 'image/png',
        encoding: 'base64',
        content: PNG_BASE64,
        isModule: false,
      },
    ],
    entryModules: [{ path: '/main.js' }],
  };

  const manifestScript = `<script type="application/json" data-vfs-manifest>${serializeVfsManifest(manifest)}</script>`;
  const bootstrap = buildVfsBootstrapScript({ projectId: 'e2e-vfs', previewVersion: 1 });

  return `<!doctype html><html><head>${manifestScript}\n${bootstrap}</head><body>
    <img id="logo" data-vfs="/logo.png" src="/logo.png" alt="logo">
    <div id="out">pending</div>
    <div id="fetch-out">pending</div>
  </body></html>`;
};

test.describe('VFS preview sandbox', () => {
  test('renders a 3-file module graph (with circular dep), image, and fetch (AC1/AC2/AC3)', async ({
    page,
  }) => {
    await page.setContent(buildArtifactHtml());

    // AC2: module graph executed (utils ↔ helper circular dep resolved via live bindings).
    await expect
      .poll(() => page.locator('#out').textContent(), { timeout: 10000 })
      .toBe('x=21 h=42');

    // AC3: fetch('./data.json') returned project file content via the fetch patch.
    await expect
      .poll(() => page.locator('#fetch-out').textContent(), { timeout: 10000 })
      .toBe('hello-vfs');

    // AC1: image asset rendered from the bootstrap-rewritten blob URL.
    await expect
      .poll(
        async () => {
          const naturalWidth = await page
            .locator('#logo')
            .evaluate((el: { naturalWidth: number }) => el.naturalWidth);
          return naturalWidth;
        },
        { timeout: 10000 },
      )
      .toBeGreaterThan(0);
  });
});
