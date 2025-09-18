import { vi } from 'vitest';

export const mockIdb = () => {
  vi.mock('idb', () => ({
    openDB: vi.fn().mockImplementation(async (_name: string, _version: number) => {
      return {
        getAll: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        getAllFromIndex: vi.fn().mockResolvedValue([]),
        transaction: vi.fn().mockImplementation((_storeName: string) => ({
          objectStore: vi.fn().mockReturnValue({
            getAll: vi.fn().mockResolvedValue([]),
            get: vi.fn().mockResolvedValue(undefined),
            put: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
            getAllFromIndex: vi.fn().mockResolvedValue([]),
          }),
          done: Promise.resolve(),
        })),
      };
    }),
  }));
};
