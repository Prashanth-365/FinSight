import { cn } from '@/lib/utils.js';

const VARIANTS = {
  primary: 'fs-btn-primary',
  secondary: 'fs-btn-secondary',
  ghost: 'fs-btn-ghost',
  danger: 'fs-btn-danger'
};

const SIZES = {
  sm: 'px-3 py-1.5 text-xs',
  md: '',
  lg: 'px-5 py-3 text-base'
};

export function Button({ variant = 'primary', size = 'md', className, ...rest }) {
  return (
    <button className={cn(VARIANTS[variant], SIZES[size], className)} {...rest} />
  );
}

export function IconButton({ className, ...rest }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-xl w-10 h-10 hover:bg-muted transition-colors text-foreground',
        className
      )}
      {...rest}
    />
  );
}
