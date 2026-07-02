import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { htmlProjectImportService } from './htmlProjectImportService';

type TestFileBits = ConstructorParameters<typeof File>[0];
type TestFileOptions = ConstructorParameters<typeof File>[2];

const toUint8Array = (part: TestFileBits[number]): Uint8Array => {
  if (typeof part === 'string') {
    return new TextEncoder().encode(part);
  }

  if (part instanceof Uint8Array) {
    return part;
  }

  if (part instanceof ArrayBuffer) {
    return new Uint8Array(part);
  }

  if (ArrayBuffer.isView(part)) {
    return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
  }

  throw new Error(`Unsupported BlobPart in test helper: ${Object.prototype.toString.call(part)}`);
};

const createTestFile = (bits: TestFileBits, name: string, options?: TestFileOptions): File => {
  const file = new File(bits, name, options);
  const bytes = bits.flatMap(part => Array.from(toUint8Array(part)));

  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => Uint8Array.from(bytes).buffer,
    configurable: true,
  });
  return file;
};

const createFileWithRelativePath = (
  bits: TestFileBits,
  name: string,
  relativePath: string,
  options?: TestFileOptions,
): File => {
  const file = createTestFile(bits, name, options);
  Object.defineProperty(file, 'webkitRelativePath', {
    value: relativePath,
    configurable: true,
  });
  return file;
};

describe('htmlProjectImportService', () => {
  it('prepares uploaded files while preserving nested folder structure and binary assets', async () => {
    const files = [
      createFileWithRelativePath(['<h1>Hello</h1>'], 'index.html', 'landing/index.html', {
        type: 'text/html',
      }),
      createFileWithRelativePath(['body { color: red; }'], 'app.css', 'landing/styles/app.css', {
        type: 'text/css',
      }),
      createFileWithRelativePath(
        [new Uint8Array([1, 2, 3])],
        'logo.png',
        'landing/assets/logo.png',
        {
          type: 'image/png',
        },
      ),
    ];

    const importedFiles = await htmlProjectImportService.prepareFilesForProjectUpload(files);

    expect(importedFiles).toEqual([
      {
        path: '/landing/index.html',
        kind: 'html',
        content: '<h1>Hello</h1>',
        encoding: 'utf-8',
      },
      {
        path: '/landing/styles/app.css',
        kind: 'css',
        content: 'body { color: red; }',
        encoding: 'utf-8',
      },
      {
        path: '/landing/assets/logo.png',
        kind: 'asset',
        content: 'AQID',
        encoding: 'base64',
      },
    ]);
  });

  it('rejects empty upload batches', async () => {
    await expect(htmlProjectImportService.prepareFilesForProjectUpload([])).rejects.toThrow(
      'Upload requires at least one file.',
    );
  });

  it('rejects duplicate normalized upload paths', async () => {
    const files = [
      createFileWithRelativePath(['<h1>Hello</h1>'], 'index.html', 'landing/index.html'),
      createFileWithRelativePath(['<h1>Override</h1>'], 'index.html', '/landing/index.html'),
    ];

    await expect(htmlProjectImportService.prepareFilesForProjectUpload(files)).rejects.toThrow(
      'Duplicate project file path: /landing/index.html',
    );
  });

  it('keeps textual assets as utf-8 content when detected by extension', async () => {
    const files = [
      createFileWithRelativePath(
        ['{"name":"Demo App"}'],
        'manifest.webmanifest',
        'manifest.webmanifest',
      ),
    ];

    const importedFiles = await htmlProjectImportService.prepareFilesForProjectUpload(files);

    expect(importedFiles).toEqual([
      {
        path: '/manifest.webmanifest',
        kind: 'asset',
        content: '{"name":"Demo App"}',
        encoding: 'utf-8',
      },
    ]);
  });

  it('imports a zip project, preserves folder structure, and infers the entry file', async () => {
    const zipBytes = zipSync({
      'demo/index.html': strToU8('<!doctype html><html></html>'),
      'demo/assets/logo.png': Uint8Array.from([72, 105]),
      'demo/scripts/app.js': strToU8('console.log("hi")'),
    });
    const zipFile = createTestFile([zipBytes], 'demo-site.zip', { type: 'application/zip' });

    const importedProject = await htmlProjectImportService.importZipProject(zipFile);

    expect(importedProject.projectName).toBe('demo-site');
    expect(importedProject.entryFile).toBe('/demo/index.html');
    expect(importedProject.files).toEqual([
      {
        path: '/demo/assets/logo.png',
        kind: 'asset',
        content: 'SGk=',
        encoding: 'base64',
      },
      {
        path: '/demo/index.html',
        kind: 'html',
        content: '<!doctype html><html></html>',
        encoding: 'utf-8',
      },
      {
        path: '/demo/scripts/app.js',
        kind: 'js',
        content: 'console.log("hi")',
        encoding: 'utf-8',
      },
    ]);
  });

  it('rejects zip imports without an html entry file', async () => {
    const zipBytes = zipSync({
      'demo/styles/app.css': strToU8('body { color: red; }'),
    });
    const zipFile = createTestFile([zipBytes], 'styles-only.zip', { type: 'application/zip' });

    await expect(htmlProjectImportService.importZipProject(zipFile)).rejects.toThrow(
      'Imported project must include at least one HTML entry file.',
    );
  });

  it('prefers root index.html and falls back to a nested html entry plus trimmed zip name', async () => {
    const zipBytes = zipSync({
      '/marketing/home.html': strToU8('<!doctype html><html><body>Home</body></html>'),
      '/index.html': strToU8('<!doctype html><html><body>Root</body></html>'),
      '/scripts/app.tsx': strToU8('export const App = () => null;'),
    });
    const zipFile = createTestFile([zipBytes], '  Landing Page.zip  ', { type: 'application/zip' });

    const importedProject = await htmlProjectImportService.importZipProject(zipFile);

    expect(importedProject.projectName).toBe('Landing Page');
    expect(importedProject.entryFile).toBe('/index.html');
    expect(importedProject.files.map(file => file.path)).toEqual([
      '/index.html',
      '/marketing/home.html',
      '/scripts/app.tsx',
    ]);
    expect(importedProject.files[2]).toMatchObject({
      kind: 'js',
      encoding: 'utf-8',
      content: 'export const App = () => null;',
    });
  });

  it('rejects empty zip imports before inferring an entry file', async () => {
    const zipBytes = zipSync({});
    const zipFile = createTestFile([zipBytes], 'empty.zip', { type: 'application/zip' });

    await expect(htmlProjectImportService.importZipProject(zipFile)).rejects.toThrow(
      'Imported project must include at least one file.',
    );
  });

  it('falls back to the default project name when the zip file name is blank after trimming', async () => {
    const zipBytes = zipSync({
      'demo/index.html': strToU8('<!doctype html><html><body>Demo</body></html>'),
    });
    const zipFile = createTestFile([zipBytes], '   .zip   ', { type: 'application/zip' });

    const importedProject = await htmlProjectImportService.importZipProject(zipFile);

    expect(importedProject.projectName).toBe('Imported HTML Project');
    expect(importedProject.entryFile).toBe('/demo/index.html');
  });

  it('rejects unsafe zip paths before writing any files', async () => {
    const zipBytes = zipSync({
      '../outside/index.html': strToU8('<h1>Unsafe</h1>'),
    });
    const zipFile = createTestFile([zipBytes], 'unsafe.zip', { type: 'application/zip' });

    await expect(htmlProjectImportService.importZipProject(zipFile)).rejects.toThrow(
      'Unsafe project file path: ../outside/index.html',
    );
  });
});
