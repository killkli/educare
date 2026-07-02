import { unzipSync } from 'fflate';
import type { HtmlProjectFileKind } from '../types';
import { normalizePath, type WriteHtmlProjectFileInput } from './htmlProjectStore';

export interface ImportedHtmlProjectData {
  projectName: string;
  entryFile: string;
  files: WriteHtmlProjectFileInput[];
}

const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

const TEXTUAL_ASSET_EXTENSIONS = ['.txt', '.xml', '.csv', '.webmanifest', '.map', '.yml', '.yaml'];

const inferHtmlProjectFileKind = (path: string): HtmlProjectFileKind => {
  const normalizedPath = path.toLowerCase();

  if (normalizedPath.endsWith('.html') || normalizedPath.endsWith('.htm')) {
    return 'html';
  }

  if (normalizedPath.endsWith('.css') || normalizedPath.endsWith('.scss')) {
    return 'css';
  }

  if (
    normalizedPath.endsWith('.js') ||
    normalizedPath.endsWith('.mjs') ||
    normalizedPath.endsWith('.cjs') ||
    normalizedPath.endsWith('.ts') ||
    normalizedPath.endsWith('.tsx') ||
    normalizedPath.endsWith('.jsx')
  ) {
    return 'js';
  }

  if (normalizedPath.endsWith('.json')) {
    return 'json';
  }

  if (normalizedPath.endsWith('.svg')) {
    return 'svg';
  }

  if (normalizedPath.endsWith('.md') || normalizedPath.endsWith('.markdown')) {
    return 'md';
  }

  return 'asset';
};

const stripLeadingSlash = (path: string): string => path.replace(/^\/+/, '');

const normalizeProjectImportPath = (path: string): string => normalizePath(path);

const ensureUniquePaths = (files: WriteHtmlProjectFileInput[]) => {
  const seenPaths = new Set<string>();

  for (const file of files) {
    if (seenPaths.has(file.path)) {
      throw new Error(`Duplicate project file path: ${file.path}`);
    }
    seenPaths.add(file.path);
  }
};

const inferProjectEntryFile = (files: WriteHtmlProjectFileInput[]): string => {
  const htmlPaths = files
    .map(file => file.path)
    .filter(path => /\.html?$/i.test(path))
    .sort((left, right) => left.localeCompare(right));

  if (htmlPaths.length === 0) {
    throw new Error('Imported project must include at least one HTML entry file.');
  }

  const rootIndex = htmlPaths.find(path => path === '/index.html');
  if (rootIndex) {
    return rootIndex;
  }

  const nestedIndex = htmlPaths.find(path => path.endsWith('/index.html'));
  if (nestedIndex) {
    return nestedIndex;
  }

  return htmlPaths[0];
};

const decodeUtf8 = (bytes: Uint8Array): string => TEXT_DECODER.decode(bytes);

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = '';

  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
};

const isTextualAsset = (path: string, mimeType?: string): boolean => {
  const normalizedPath = path.toLowerCase();
  const normalizedMimeType = mimeType?.toLowerCase() || '';

  return (
    normalizedMimeType.startsWith('text/') ||
    normalizedMimeType.includes('json') ||
    normalizedMimeType.includes('xml') ||
    normalizedMimeType.includes('javascript') ||
    normalizedMimeType.includes('svg') ||
    TEXTUAL_ASSET_EXTENSIONS.some(extension => normalizedPath.endsWith(extension))
  );
};

const createWriteInput = (
  rawPath: string,
  bytes: Uint8Array,
  options?: { mimeType?: string },
): WriteHtmlProjectFileInput => {
  const path = normalizeProjectImportPath(rawPath);
  const kind = inferHtmlProjectFileKind(path);

  if (kind === 'asset' && !isTextualAsset(path, options?.mimeType)) {
    return {
      path,
      kind,
      content: encodeBase64(bytes),
      encoding: 'base64',
    };
  }

  return {
    path,
    kind,
    content: decodeUtf8(bytes),
    encoding: 'utf-8',
  };
};

const deriveProjectNameFromZip = (fileName: string): string => {
  const stripped = fileName
    .trim()
    .replace(/\.zip$/i, '')
    .trim();
  return stripped || 'Imported HTML Project';
};

const createImportedProjectData = (
  projectName: string,
  files: WriteHtmlProjectFileInput[],
): ImportedHtmlProjectData => {
  if (files.length === 0) {
    throw new Error('Imported project must include at least one file.');
  }

  const sortedFiles = [...files].sort((left, right) => left.path.localeCompare(right.path));
  ensureUniquePaths(sortedFiles);

  return {
    projectName: projectName.trim() || 'Imported HTML Project',
    entryFile: inferProjectEntryFile(sortedFiles),
    files: sortedFiles,
  };
};

type FileWithRelativePath = File & { webkitRelativePath?: string };

const prepareUploadedFile = async (file: File): Promise<WriteHtmlProjectFileInput> => {
  const uploadPath = (file as FileWithRelativePath).webkitRelativePath || file.name;
  const arrayBuffer = await file.arrayBuffer();
  return createWriteInput(uploadPath, new Uint8Array(arrayBuffer), { mimeType: file.type });
};

class HtmlProjectImportService {
  async prepareFilesForProjectUpload(files: File[]): Promise<WriteHtmlProjectFileInput[]> {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('Upload requires at least one file.');
    }

    const importedFiles = await Promise.all(files.map(file => prepareUploadedFile(file)));
    ensureUniquePaths(importedFiles);
    return importedFiles;
  }

  async importZipProject(file: File): Promise<ImportedHtmlProjectData> {
    if (!file) {
      throw new Error('ZIP import requires a file.');
    }

    const archiveBytes = new Uint8Array(await file.arrayBuffer());
    const archiveEntries = unzipSync(archiveBytes);
    const importedFiles = Object.entries(archiveEntries)
      .filter(([entryPath]) => entryPath && !entryPath.endsWith('/'))
      .map(([entryPath, bytes]) => createWriteInput(stripLeadingSlash(entryPath), bytes));

    return createImportedProjectData(deriveProjectNameFromZip(file.name), importedFiles);
  }
}

export const htmlProjectImportService = new HtmlProjectImportService();
