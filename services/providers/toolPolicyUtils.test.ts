import { describe, expect, it } from 'vitest';

import { resolveToolPolicy } from './toolPolicyUtils';

const TOOL_DEFINITIONS = [
  {
    name: 'render_preview',
    description: 'Render preview',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_docs',
    description: 'Search docs',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
] as const;

describe('resolveToolPolicy', () => {
  it('filters visible tools to the allowed set', () => {
    const policy = resolveToolPolicy({
      tools: [...TOOL_DEFINITIONS],
      allowedToolNames: ['search_docs'],
    });

    expect(policy.toolChoice).toEqual({ mode: 'auto' });
    expect(policy.visibleTools).toEqual([
      expect.objectContaining({
        name: 'search_docs',
      }),
    ]);
  });

  it('rejects duplicate tool definitions', () => {
    expect(() =>
      resolveToolPolicy({
        tools: [
          ...TOOL_DEFINITIONS,
          {
            ...TOOL_DEFINITIONS[0],
          },
        ],
      }),
    ).toThrow('Duplicate tool definition: render_preview');
  });

  it('rejects unknown allowed tool names', () => {
    expect(() =>
      resolveToolPolicy({
        tools: [...TOOL_DEFINITIONS],
        allowedToolNames: ['missing_tool'],
      }),
    ).toThrow('Unknown tools in allowedToolNames: missing_tool');
  });

  it('rejects requireSpecific when the requested tool is not visible', () => {
    expect(() =>
      resolveToolPolicy({
        tools: [...TOOL_DEFINITIONS],
        allowedToolNames: ['search_docs'],
        toolChoice: { mode: 'requireSpecific', name: 'render_preview' },
      }),
    ).toThrow('Requested tool is not visible: render_preview');
  });
});
