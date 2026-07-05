/// <reference types="vitest/globals" />
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreviewFrame } from '../PreviewFrame';
import type { HtmlProjectPreviewArtifact } from '../../../types';

const readyArtifact = (
  overrides: Partial<HtmlProjectPreviewArtifact> = {},
): HtmlProjectPreviewArtifact => ({
  projectId: 'p-1',
  previewVersion: 3,
  entryFile: '/index.html',
  previewReady: true,
  previewUrlType: 'blob',
  html: '<!doctype html><html></html>',
  url: 'blob:preview-1',
  warnings: [],
  error: null,
  diagnostics: { category: 'none', outcome: 'ready', repairable: false, summary: 'ok' },
  generatedAt: 1700000000000,
  ...overrides,
});

describe('PreviewFrame sandbox (AC6)', () => {
  it('renders the iframe with allow-scripts allow-forms allow-modals and NO allow-same-origin', () => {
    const { container } = render(<PreviewFrame preview={readyArtifact()} />);
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const sandbox = iframe?.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-forms');
    expect(sandbox).toContain('allow-modals');
    // Critical security invariant: opaque origin MUST be preserved (V FS plan principle ①).
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('shows the preview-error state when previewReady is false', () => {
    const { container, getByText } = render(
      <PreviewFrame
        preview={readyArtifact({ previewReady: false, url: undefined, error: 'boom' })}
      />,
    );
    expect(container.querySelector('iframe')).toBeNull();
    expect(getByText('Preview error')).toBeTruthy();
  });

  it('shows the empty state when no preview is provided', () => {
    const { container } = render(<PreviewFrame preview={null} />);
    expect(container.querySelector('iframe')).toBeNull();
  });
});
