import React from 'react';
import { HtmlProjectFileDescriptor } from '../../types';

interface FileTreeProps {
  files: HtmlProjectFileDescriptor[];
  entryFile: string;
}

export function FileTree({ files, entryFile }: FileTreeProps): React.JSX.Element {
  if (files.length === 0) {
    return <p className='text-sm text-gray-400'>目前尚未建立任何檔案。</p>;
  }

  return (
    <ul className='space-y-2'>
      {files.map(file => {
        const isEntry = file.path === entryFile;
        return (
          <li
            key={file.path}
            className='rounded-xl border border-gray-700/70 bg-gray-900/70 px-3 py-2 text-sm text-gray-100'
          >
            <div className='flex items-center justify-between gap-3'>
              <div>
                <p className='font-medium'>
                  {file.path}
                  {isEntry && <span className='ml-2 text-xs text-cyan-300'>entry</span>}
                </p>
                <p className='mt-1 text-xs text-gray-400'>
                  {file.kind} · {file.size} chars
                </p>
              </div>
              <p className='text-xs text-gray-500'>
                {new Date(file.updatedAt).toLocaleTimeString('zh-TW', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
