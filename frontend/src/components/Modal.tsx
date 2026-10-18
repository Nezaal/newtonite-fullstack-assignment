import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
}

// Uses the browser's own <dialog>, which gives us Escape-to-close and focus trapping for free.
export function Modal({ title, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="modal card"
      aria-labelledby="modal-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="modal__head">
        <h2 id="modal-title">{title}</h2>
        <button type="button" className="btn btn--ghost btn--small" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>
      {children}
    </dialog>
  )
}
