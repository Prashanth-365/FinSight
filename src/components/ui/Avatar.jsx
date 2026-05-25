import { cn } from '@/lib/utils.js';

const SIZES = { xs: 'w-6 h-6 text-[10px]', sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-lg' };

export function Avatar({ name = '', avatar, color = '#22d3ee', size = 'sm', className, ring = false }) {
  const initial = avatar?.length === 2 || avatar?.length === 1 ? avatar : (name?.[0] ?? '?').toUpperCase();
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium shrink-0',
        SIZES[size],
        ring && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        className
      )}
      style={{ background: color + '22', color }}
      aria-label={name}
    >
      {initial}
    </span>
  );
}
