/**
 * VFS build-time rewriters (V3, V10) — services/html-canvas-vfs-sandbox-plan.md
 *
 * Module specifier rewrite is the PRIMARY module-resolution strategy. At build time, every
 * relative specifier inside ES module source (external module files AND inline `<script type="module">`
 * blocks) is rewritten to the absolute form `vfs:/path`. The runtime import map then maps
 * `vfs:/path → blob URL`. Because all module blobs are created before the import map is assembled,
 * circular dependencies resolve naturally (no topological sort — the v1 relative-key scheme was
 * rejected because relative import-map keys fail per the URL spec against a blob document base).
 *
 * Limitations explicitly out of scope (V10 prompting boundaries):
 *   - Dynamic `import()` whose specifier is built by string concatenation at runtime (only a
 *     literal string argument can be statically rewritten).
 *   - Bare specifiers (`import 'react'`) — left untouched; they will not resolve unless the agent
 *     bundles them.
 */

const EXTERNAL_SPECIFIER_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;

const isLocalSpecifier = (specifier: string): boolean =>
  specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');

/**
 * Resolve a relative module specifier against the importing file's path to an absolute project
 * path. Returns null for bare specifiers and external URLs (not rewritten).
 */
export function resolveModuleSpecifier(filePath: string, specifier: string): string | null {
  if (!isLocalSpecifier(specifier) || EXTERNAL_SPECIFIER_PATTERN.test(specifier)) {
    return null;
  }
  const baseSegments = filePath.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      baseSegments.pop();
      continue;
    }
    baseSegments.push(segment);
  }
  return `/${baseSegments.join('/')}`.replace(/\/+/g, '/');
}

export interface RewrittenModule {
  code: string;
  /** Specifiers that were detected but could not be resolved (kept verbatim). Empty on success. */
  unresolved: string[];
}

/**
 * Rewrite `from '...'`, `import '...'` (side-effect), and `import('...')` (literal dynamic)
 * specifiers from relative form to `vfs:/path`. Bare specifiers and external URLs are preserved.
 *
 * Rewrites only the literal specifier string of static import/export statements and literal-argument
 * dynamic imports — it does NOT touch string concatenation, template literals, or comments that
 * merely look like imports (the known regex-false-positive surface is exercised by unit tests).
 */
export function rewriteModuleSpecifiers(code: string, filePath: string): RewrittenModule {
  if (!code) {
    return { code, unresolved: [] };
  }
  const unresolved: string[] = [];

  const apply = (specifier: string): string | null => {
    const resolved = resolveModuleSpecifier(filePath, specifier);
    if (resolved) {
      return `vfs:${resolved}`;
    }
    // Track bare/external specifiers we deliberately did not rewrite (informational only).
    if (isLocalSpecifier(specifier) && !EXTERNAL_SPECIFIER_PATTERN.test(specifier)) {
      unresolved.push(specifier);
    }
    return null;
  };

  // from '...' / import '...' (side-effect). The `import` branch only matches side-effect imports
  // because a binding import (`import {x} from`) has no quote immediately after `import`.
  let out = code.replace(
    /\b(from|import)\s*(['"])([^'"]+)\2/g,
    (match, kw: string, quote: string, specifier: string) => {
      const rewritten = apply(specifier);
      return rewritten ? `${kw} ${quote}${rewritten}${quote}` : match;
    },
  );

  // import('...') — literal dynamic import only.
  out = out.replace(
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    (match, quote: string, specifier: string) => {
      const rewritten = apply(specifier);
      return rewritten ? `import(${quote}${rewritten}${quote})` : match;
    },
  );

  return { code: out, unresolved };
}
