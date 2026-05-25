import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils.js';

// Generic modal (centered card) and Sheet (bottom drawer on mobile, side panel on desktop)
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  const widthCls = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-md';

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        className={cn('relative w-full fs-card animate-slide-up', widthCls)}
      >
        <div className="flex items-center justify-between p-4 pb-2">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-fg">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 pb-4">{children}</div>
        {footer && <div className="border-t border-border p-3 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function Sheet({ open, onClose, title, children, footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] animate-fade-in">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          'absolute bg-surface border-t border-border rounded-t-2xl shadow-card-dark animate-slide-up flex flex-col',
          'left-0 right-0 bottom-0 max-h-[92vh]',
          'md:left-auto md:right-0 md:top-0 md:bottom-0 md:max-h-none md:w-[460px] md:rounded-t-none md:rounded-l-2xl md:border-t-0 md:border-l'
        )}
      >
        <div className="flex items-center justify-between p-4 pb-3 border-b border-border">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-fg">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 flex-1">{children}</div>
        {footer && <div className="border-t border-border p-3 flex justify-end gap-2 safe-bottom">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmText = 'Confirm', danger = false }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button className="fs-btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className={danger ? 'fs-btn-danger' : 'fs-btn-primary'}
            onClick={async () => { await onConfirm?.(); onClose?.(); }}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted-fg">{message}</p>
    </Modal>
  );
}
