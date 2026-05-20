import { describe, it, expect } from 'vitest';
import { readSseDataLines } from './sse';

function createReader(chunks: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return stream.getReader();
}

describe('readSseDataLines', () => {
  it('reassembles lines split across chunks', async () => {
    const reader = createReader(['data: {"cho', 'ices":[{"delta":{"content":"Hi"}}]}\n']);

    const lines = [];
    for await (const line of readSseDataLines(reader)) {
      lines.push(line);
    }

    expect(lines).toEqual(['{"choices":[{"delta":{"content":"Hi"}}]}']);
  });

  it('handles multiple lines, empty chunks, and a final line without trailing newline', async () => {
    const reader = createReader([
      'data: one\n\n',
      '',
      'data: two\r\n',
      'event: ignore\n',
      'data: [DONE]',
    ]);

    const lines = [];
    for await (const line of readSseDataLines(reader)) {
      lines.push(line);
    }

    expect(lines).toEqual(['one', 'two', '[DONE]']);
  });
});
