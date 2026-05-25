import { cn } from '@/lib/utils.js';

export function EmptyState({ icon: Icon, title, hint, action, className }) {
  return (
    <div className={cn('text-center py-10 px-4', className)}>
      {Icon && (
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-muted text-muted-fg mb-3">
          <Icon className="w-7 h-7" />
        </div>
      )}
      {title && <h3 className="text-base font-semibold mb-1">{title}</h3>}
      {hint && <p className="text-sm text-muted-fg max-w-sm mx-auto">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cn('fs-skeleton h-4 w-full', className)} />;
}
