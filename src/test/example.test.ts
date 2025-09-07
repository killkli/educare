import { describe, it, expect } from 'vitest';

describe('Example Test Suite', () => {
  it('should pass basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should handle strings', () => {
    const message = 'Hello World';
    expect(message).toBe('Hello World');
    expect(message.length).toBe(11);
  });

  it('should work with arrays', () => {
    const numbers = [1, 2, 3, 4, 5];
    expect(numbers).toHaveLength(5);
    expect(numbers[0]).toBe(1);
    expect(numbers[4]).toBe(5);
  });

  it('should handle async operations', async () => {
    const asyncOperation = () => Promise.resolve('success');
    const result = await asyncOperation();
    expect(result).toBe('success');
  });
});
