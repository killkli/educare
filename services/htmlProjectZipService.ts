import { strToU8, zipSync } from 'fflate';
import { htmlProjectStore } from './htmlProjectStore';

const sanitizeFileName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'html-project';
  }

  return Array.from(trimmed)
    .map(char => {
      const code = char.charCodeAt(0);
      const isControl = code >= 0 && code <= 31;
      return /[<>:"/\\|?*]/.test(char) || isControl ? '-' : char;
    })
    .join('')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
};

const decodeBase64 = (content: string): Uint8Array => {
  if (typeof globalThis.atob !== 'function') {
    throw new Error('Base64 decoding is not available in this environment.');
  }

  const decoded = globalThis.atob(content);
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
};

const toArchivePath = (path: string): string => {
  const normalizedPath = path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(segment => segment.length > 0 && segment !== '.')
    .join('/');

  if (!normalizedPath || normalizedPath.split('/').includes('..')) {
    throw new Error(`Unsafe ZIP archive path: ${path}`);
  }

  return normalizedPath;
};

export interface HtmlProjectZipResult {
  fileCount: number;
  fileName: string;
  projectId: string;
  projectName: string;
}

class HtmlProjectZipService {
  async downloadProjectZip(projectId: string, assistantId: string): Promise<HtmlProjectZipResult> {
    const project = await htmlProjectStore.assertProjectOwnership(projectId, assistantId);
    const files = await htmlProjectStore.listProjectFiles(project.id);

    if (files.length === 0) {
      throw new Error('HTML project has no files to export.');
    }

    const archive = Object.fromEntries(
      files.map(file => [
        toArchivePath(file.path),
        file.encoding === 'base64' ? decodeBase64(file.content) : strToU8(file.content),
      ]),
    );

    const zipData = zipSync(archive, { level: 6 });
    const blob = new globalThis.Blob([zipData], { type: 'application/zip' });
    const fileName = `${sanitizeFileName(project.name)}.zip`;
    const objectUrl = URL.createObjectURL(blob);

    try {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }

    return {
      fileCount: files.length,
      fileName,
      projectId: project.id,
      projectName: project.name,
    };
  }
}

export const htmlProjectZipService = new HtmlProjectZipService();
