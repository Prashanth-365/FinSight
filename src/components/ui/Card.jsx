import { cn } from '@/lib/utils.js';

export function Card({ className, ...rest }) {
  return <div className={cn('fs-card', className)} {...rest} />;
}

export function CardHeader({ className, ...rest }) {
  return <div className={cn('p-4 pb-2', className)} {...rest} />;
}

export function CardTitle({ className, ...rest }) {
  return <h3 className={cn('text-base font-semibold', className)} {...rest} />;
}

export function CardSubtitle({ className, ...rest }) {
  return <p className={cn('text-xs text-muted-fg', className)} {...rest} />;
}

export function CardBody({ className, ...rest }) {
  return <div className={cn('p-4 pt-2', className)} {...rest} />;
}
