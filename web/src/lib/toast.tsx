import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

const ToastContext = createContext<(kind: Toast['kind'], text: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

/** Meldet einen API-Fehler als verständlichen Hinweis. */
export function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Unbekannter Fehler.';
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed right-4 top-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={`rounded-lg px-4 py-3 text-sm shadow-lg ${
              t.kind === 'error' ? 'bg-red-900/95 text-red-100' : 'bg-neutral-800/95 text-neutral-100'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
