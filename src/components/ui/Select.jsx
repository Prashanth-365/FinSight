import { cn } from '@/lib/utils.js';

export function Select({ value, onChange, options = [], className, ...rest }) {
  return (
    <select
      className={cn('fs-input pr-8 appearance-none bg-no-repeat bg-right', className)}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      {...rest}
    >
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>
          {o.label ?? o}
        </option>
      ))}
    </select>
  );
}
