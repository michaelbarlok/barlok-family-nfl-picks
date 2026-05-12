import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface ToastContextValue {
  show: (text: string, kind?: ToastKind) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, kind, text }])
  }, [])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDone={() => setToasts(arr => arr.filter(x => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 3500)
    const t2 = setTimeout(onDone, 3800)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [onDone])

  const colorClass =
    toast.kind === 'success' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
    : toast.kind === 'error' ? 'bg-red-500/15 border-red-500/30 text-red-300'
    : 'bg-blue-500/15 border-blue-500/30 text-blue-300'

  const icon = toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '✗' : 'ℹ'

  return (
    <div
      className={`pointer-events-auto px-4 py-2.5 rounded-xl border text-sm font-medium shadow-lg backdrop-blur-md flex items-center gap-2 max-w-sm ${colorClass} ${
        leaving ? 'animate-toast-out' : 'animate-toast-in'
      }`}
      role="status"
    >
      <span className="text-base leading-none">{icon}</span>
      <span>{toast.text}</span>
    </div>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Safe fallback: if used outside provider, log to console rather than crash.
    return {
      show: (text: string, kind?: ToastKind) => {
        if (kind === 'error') console.error('[toast]', text)
        else console.log('[toast]', text)
      },
    }
  }
  return ctx
}
