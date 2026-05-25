import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils.js';

const ToastContext = createContext(null);
let _id = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback((opts) => {
    const id = ++_id;
    const t = { id, type: 'info', duration: 3000, ...(typeof opts === 'string' ? { message: opts } : opts) };
    setToasts((prev) => [...prev, t]);
    if (t.duration) setTimeout(() => dismiss(id), t.duration);
  }, [dismiss]);

  const ctx = {
    toast,
    success: (msg) => toast({ type: 'success', message: msg }),
    error: (msg) => toast({ type: 'error', message: msg, duration: 5000 }),
    info: (msg) => toast({ type: 'info', message: msg })
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="fixed z-[120] bottom-20 left-1/2 -translate-x-1/2 flex flex-col gap-2 w-[min(92vw,360px)] pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto fs-card px-3.5 py-3 flex items-start gap-2.5 animate-slide-up',
              t.type === 'success' && 'border-success/50',
              t.type === 'error' && 'border-danger/50',
              t.type === 'info' && 'border-primary/40'
            )}
          >
            {t.type === 'success' && <CheckCircle2 className="w-4 h-4 mt-0.5 text-success shrink-0" />}
            {t.type === 'error' && <AlertTriangle className="w-4 h-4 mt-0.5 text-danger shrink-0" />}
            {t.type === 'info' && <Info className="w-4 h-4 mt-0.5 text-primary shrink-0" />}
            <p className="text-sm flex-1 leading-snug">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-muted-fg hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
