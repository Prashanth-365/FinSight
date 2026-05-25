import { forwardRef } from 'react';
import { cn } from '@/lib/utils.js';

export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn('fs-input', className)} {...rest} />;
});

export const Textarea = forwardRef(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn('fs-input min-h-[80px]', className)} {...rest} />;
});

export function Label({ className, ...rest }) {
  return <label className={cn('text-xs font-medium text-muted-fg mb-1.5 block', className)} {...rest} />;
}

export function Field({ label, hint, error, children, className }) {
  return (
    <div className={cn('mb-3', className)}>
      {label && <Label>{label}</Label>}
      {children}
      {hint && !error && <p className="text-xs text-muted-fg mt-1">{hint}</p>}
      {error && <p className="text-xs text-danger mt-1">{error}</p>}
    </div>
  );
}
