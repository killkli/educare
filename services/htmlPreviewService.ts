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

    return {
      projectId: project.id,
      previewVersion: project.previewVersion,
      entryFile: project.entryFile,
      previewReady: true,
      previewUrlType: 'blob',
      html,
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
