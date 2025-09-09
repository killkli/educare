import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Button from '../Button';

describe('Button', () => {
  it('renders with default props', () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole('button', { name: /click me/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('inline-flex', 'items-center', 'justify-center');
  });

  it('applies primary variant styles by default', () => {
    render(<Button>Primary</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('bg-gradient-to-r', 'from-cyan-600', 'to-cyan-500');
  });

  it('applies correct variant styles', () => {
    const { rerender } = render(<Button variant='secondary'>Secondary</Button>);
    let button = screen.getByRole('button');
    expect(button).toHaveClass('from-purple-600', 'to-purple-500');

    rerender(<Button variant='icon'>Icon</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('p-1.5', 'text-gray-400');

    rerender(<Button variant='danger'>Danger</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('hover:text-red-400', 'hover:bg-red-500/20');
  });

  it('applies size classes correctly', () => {
    const { rerender } = render(<Button size='sm'>Small</Button>);
    let button = screen.getByRole('button');
    expect(button).toHaveClass('text-sm');

    rerender(<Button size='lg'>Large</Button>);
    button = screen.getByRole('button');
    expect(button).toHaveClass('text-lg');
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('shows loading state', () => {
    render(<Button loading>Loading</Button>);
    const button = screen.getByRole('button');

    expect(button).toBeDisabled();
    expect(button.querySelector('svg')).toBeInTheDocument();
    expect(button.querySelector('svg')).toHaveClass('animate-spin');
  });

  it('is disabled when loading', () => {
    render(<Button loading>Loading</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveClass('disabled:opacity-50');
  });

  it('applies custom className', () => {
    render(<Button className='custom-class'>Custom</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('custom-class');
  });

  it('forwards HTML button attributes', () => {
    render(
      <Button type='submit' aria-label='Submit form'>
        Submit
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toHaveAttribute('aria-label', 'Submit form');
  });
});
