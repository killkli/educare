import { expect, test } from '@playwright/test';
import type { HtmlProject, HtmlProjectFile } from '../../types';
import { htmlPreviewService } from '../../services/htmlPreviewService';

/**
 * VFS sandbox end-to-end (AC2/AC1/AC3, V5/V9). Renders a three-file ES module project that
 * includes a circular dependency, an image asset, and a fetch() of a project JSON file through the
 * REAL htmlPreviewService.buildArtifact pipeline (build→bootstrap contract, architect #4), then
 * loads the produced artifact HTML in a real browser (chromium + webkit) and asserts the module
 * graph executed, the image rendered, and fetch returned project content. This validates the
 * import-map + vfs:/ specifier resolution and the fetch/data-vfs patches that pure unit tests
 * cannot, end to end through the actual build pipeline.
 */

// 1x1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const project: HtmlProject = {
  id: 'e2e-vfs',
  assistantId: 'a',
  sessionId: 's',
  name: 'VFS E2E',
  entryFile: '/index.html',
  status: 'draft',
  previewVersion: 1,
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
  projectId: 'e2e-vfs',
  path,
  kind: path.endsWith('.css')
    ? 'css'
    : path.endsWith('.js')
      ? 'js'
      : path.endsWith('.json')
        ? 'json'
        : path.endsWith('.png')
          ? 'asset'
          : 'html',
  content,
  encoding: 'utf-8',
  dependencies: [],
  size: content.length,
  updatedAt: 1700000000000,
  ...overrides,
});

const buildArtifactHtml = (): string => {
  const main = `import { x } from './utils.js';
import { h } from './lib/helper.js';
document.getElementById('out').textContent = 'x=' + x + ' h=' + h();
fetch('./data.json').then(r => r.json()).then(d => {
  document.getElementById('fetch-out').textContent = d.value;
});`;
  const utils = `import { h } from './lib/helper.js';
export const x = 21;`;
  const helper = `import { x } from '../utils.js';
export const h = () => x * 2;`;

  const files: HtmlProjectFile[] = [
    makeFile(
      '/index.html',
      `<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body>
        <img id="logo" src="./logo.png" alt="logo">
        <div id="out">pending</div>
        <div id="fetch-out">pending</div>
        <script type="module" src="./main.js"></script>
      </body></html>`,
    ),
    makeFile('/main.js', main),
    makeFile('/utils.js', utils),
    makeFile('/lib/helper.js', helper),
    makeFile('/data.json', '{"value":"hello-vfs"}', { kind: 'json' }),
    makeFile('/logo.png', PNG_BASE64, { kind: 'asset', encoding: 'base64' }),
    makeFile('/styles.css', 'body { font-family: sans-serif; }'),
  ];

  const artifact = htmlPreviewService.buildArtifact(project, files);
  if (!artifact.previewReady) {
    throw new Error(`artifact not previewReady: ${artifact.error ?? ''}`);
  }
  return artifact.html;
};

test.describe('VFS preview sandbox', () => {
  test('renders a 3-file module graph (with circular dep), image, and fetch through the real build pipeline (AC1/AC2/AC3)', async ({
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

    // AC1: image asset rendered from the build-pipeline-tagged data-vfs → bootstrap blob URL.
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
