import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastApi } from './toast-context'

interface ToastMessage {
  id: number
  kind: 'success' | 'error'
  text: string
}

const VISIBLE_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])

  const show = useCallback(
    (kind: ToastMessage['kind'], text: string) => {
      const id = nextId.current++
      setToasts((all) => [...all.slice(-3), { id, kind, text }])
      window.setTimeout(() => dismiss(id), VISIBLE_MS)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({ success: (m) => show('success', m), error: (m) => show('error', m) }),
    [show],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span>{t.text}</span>
            <button type="button" className="toast__close" onClick={() => dismiss(t.id)} aria-label="Dismiss message">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
