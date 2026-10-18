interface StatCardProps {
  label: string
  count: number | undefined
  active: boolean
  onToggle: () => void
}

// One of the four dashboard views. Clicking filters the list below; clicking again clears it.
export function StatCard({ label, count, active, onToggle }: StatCardProps) {
  return (
    <button type="button" className={`card stat${active ? ' card--selected' : ''}`} aria-pressed={active} onClick={onToggle}>
      <span className="stat__label">{label}</span>
      <span className={`score${active ? ' score--yellow' : ''}`}>{count ?? '–'}</span>
    </button>
  )
}
