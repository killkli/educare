import { describe, expect, it } from 'vitest';
import { resolveModuleSpecifier, rewriteModuleSpecifiers } from './previewVfsRewriter';

describe('resolveModuleSpecifier', () => {
  it('resolves relative specifiers against the importing file path', () => {
    expect(resolveModuleSpecifier('/src/main.js', './utils.js')).toBe('/src/utils.js');
    expect(resolveModuleSpecifier('/src/lib/helper.js', '../utils.js')).toBe('/src/utils.js');
    expect(resolveModuleSpecifier('/index.js', '/vendor/x.js')).toBe('/vendor/x.js');
  });

  it('returns null for bare specifiers and external URLs', () => {
    expect(resolveModuleSpecifier('/main.js', 'react')).toBeNull();
    expect(resolveModuleSpecifier('/main.js', 'https://cdn.example.com/x.js')).toBeNull();
    expect(resolveModuleSpecifier('/main.js', '//cdn/x.js')).toBeNull();
  });
});

describe('rewriteModuleSpecifiers', () => {
  it('rewrites import ... from, side-effect import, and export ... from', () => {
    const code = `
import { x } from './utils.js';
import './polyfill.js';
export { y } from '../lib/helper.js';
`;
    const { code: out, unresolved } = rewriteModuleSpecifiers(code, '/src/main.js');
    expect(unresolved).toEqual([]);
    expect(out).toContain("from 'vfs:/src/utils.js'");
    expect(out).toContain("import 'vfs:/src/polyfill.js';");
    expect(out).toContain("from 'vfs:/lib/helper.js'");
  });

  it('rewrites literal dynamic import() specifiers', () => {
    const code = "const m = await import('./lazy.js');";
    const { code: out } = rewriteModuleSpecifiers(code, '/app.js');
    expect(out).toContain("import('vfs:/lazy.js')");
  });

  it('preserves bare specifiers and external URLs untouched', () => {
    const code = `
import React from 'react';
import h from 'https://cdn.example.com/h.js';
import { s } from 'vfs:/already/rewritten.js';
`;
    const { code: out, unresolved } = rewriteModuleSpecifiers(code, '/main.js');
    expect(out).toContain("from 'react'");
    expect(out).toContain("from 'https://cdn.example.com/h.js'");
    expect(out).toContain("from 'vfs:/already/rewritten.js'");
    // bare 'react' is not local, so it is not flagged unresolved
    expect(unresolved).toEqual([]);
  });

  it('handles namespace and default imports', () => {
    const code = `
import * as ns from './ns.js';
import def from './def.js';
`;
    const { code: out } = rewriteModuleSpecifiers(code, '/main.js');
    expect(out).toContain("from 'vfs:/ns.js'");
    expect(out).toContain("from 'vfs:/def.js'");
  });

  it('KNOWN LIMITATION (V10): import-like text inside string literals MAY be rewritten', () => {
    // Regex-based rewriting cannot distinguish a real import from an import-shaped substring
    // inside a string literal. This false-positive surface is documented in the plan (V10) and
    // surfaced to the agent via prompting (htmlProjectPrompting). The test pins the actual
    // behavior so regressions are detected; if a proper AST-based rewriter replaces this later,
    // the assertion should flip to expect no rewrite.
    const code = 'const msg = "import x from \'./not-a-real-import.js\'";';
    const { code: out } = rewriteModuleSpecifiers(code, '/main.js');
    expect(out).toContain('vfs:/not-a-real-import.js');
  });

  it('does not rewrite a bare specifier inside a real import statement', () => {
    const code = "import React from 'react';";
    const { code: out, unresolved } = rewriteModuleSpecifiers(code, '/main.js');
    expect(out).toBe(code);
    expect(unresolved).toEqual([]);
  });

  it('handles specifiers with leading ./ and ../ mixed', () => {
    const code = "import a from './a.js'; import b from './../b.js'; import c from '../../c.js';";
    const { code: out } = rewriteModuleSpecifiers(code, '/src/sub/main.js');
    expect(out).toContain("from 'vfs:/src/sub/a.js'");
    expect(out).toContain("from 'vfs:/src/b.js'");
    expect(out).toContain("from 'vfs:/c.js'");
  });
});
