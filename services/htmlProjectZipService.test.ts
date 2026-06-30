import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAssertProjectOwnership, mockListProjectFiles, mockZipSync, mockStrToU8 } = vi.hoisted(
  () => ({
    mockAssertProjectOwnership: vi.fn(),
    mockListProjectFiles: vi.fn(),
    mockZipSync: vi.fn(),
    mockStrToU8: vi.fn(),
  }),
);

vi.mock('./htmlProjectStore', () => ({
  htmlProjectStore: {
    assertProjectOwnership: mockAssertProjectOwnership,
    listProjectFiles: mockListProjectFiles,
  },
}));

vi.mock('fflate', () => ({
  zipSync: mockZipSync,
  strToU8: mockStrToU8,
}));

describe('htmlProjectZipService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockStrToU8.mockImplementation((value: string) => `utf8:${value}`);
    mockZipSync.mockReturnValue(new Uint8Array([1, 2, 3]));

    Object.defineProperty(globalThis, 'atob', {
      value: vi.fn((value: string) => {
        if (value === 'SGk=') {
          return 'Hi';
        }
        return '';
      }),
      configurable: true,
      writable: true,
    });

    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:zip-1'),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  it('exports owned project files as a downloadable zip and returns file metadata', async () => {
    mockAssertProjectOwnership.mockResolvedValue({
      id: 'project-1',
      name: 'Existing Landing Page',
      assistantId: 'assistant-1',
    });
    mockListProjectFiles.mockResolvedValue([
      {
        projectId: 'project-1',
        path: '/index.html',
        kind: 'html',
        content: '<h1>Hello</h1>',
        encoding: 'utf-8',
      },
      {
        projectId: 'project-1',
        path: '/assets/logo.txt',
        kind: 'asset',
        content: 'SGk=',
        encoding: 'base64',
      },
    ]);

    const appendChildSpy = vi.spyOn(document.body, 'appendChild');
    const clickSpy = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => undefined);
    const removeSpy = vi.spyOn(HTMLElement.prototype, 'remove');

    const { htmlProjectZipService } = await import('./htmlProjectZipService');

    const result = await htmlProjectZipService.downloadProjectZip('project-1', 'assistant-1');

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockListProjectFiles).toHaveBeenCalledWith('project-1');
    expect(mockStrToU8).toHaveBeenCalledWith('<h1>Hello</h1>');
    expect(mockZipSync).toHaveBeenCalledWith(
      {
        'index.html': 'utf8:<h1>Hello</h1>',
        'assets/logo.txt': Uint8Array.from([72, 105]),
      },
      { level: 6 },
    );
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(appendChildSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:zip-1');
    expect(result).toEqual({
      fileCount: 2,
      fileName: 'existing-landing-page.zip',
      projectId: 'project-1',
      projectName: 'Existing Landing Page',
    });

    appendChildSpy.mockRestore();
    clickSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('throws a clear error when the owned project has no files to export', async () => {
    mockAssertProjectOwnership.mockResolvedValue({
      id: 'project-1',
      name: 'Empty Project',
      assistantId: 'assistant-1',
    });
    mockListProjectFiles.mockResolvedValue([]);

    const { htmlProjectZipService } = await import('./htmlProjectZipService');

    await expect(
      htmlProjectZipService.downloadProjectZip('project-1', 'assistant-1'),
    ).rejects.toThrow('HTML project has no files to export.');

    expect(mockZipSync).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('rejects unsafe archive paths that try to traverse outside the project root', async () => {
    mockAssertProjectOwnership.mockResolvedValue({
      id: 'project-1',
      name: 'Unsafe Project',
      assistantId: 'assistant-1',
    });
    mockListProjectFiles.mockResolvedValue([
      {
        projectId: 'project-1',
        path: '/../../malicious.html',
        kind: 'html',
        content: '<script>alert(1)</script>',
        encoding: 'utf-8',
      },
    ]);

    const { htmlProjectZipService } = await import('./htmlProjectZipService');

    await expect(
      htmlProjectZipService.downloadProjectZip('project-1', 'assistant-1'),
    ).rejects.toThrow('Unsafe ZIP archive path: /../../malicious.html');

    expect(mockZipSync).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
