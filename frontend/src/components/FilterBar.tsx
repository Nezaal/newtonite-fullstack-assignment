import type { ItemFilters, ItemType, Priority, Status } from '../api/types'
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, STATUSES, TYPE_LABEL, TYPES } from '../lib/format'

interface FilterBarProps {
  filters: ItemFilters
  searchText: string
  onSearchText: (text: string) => void
  onChange: (change: Partial<ItemFilters>) => void
  onClear: () => void
  teams: { id: number; name: string }[]
}

const toNumber = (value: string): number | undefined => (value === '' ? undefined : Number(value))

export function FilterBar({ filters, searchText, onSearchText, onChange, onClear, teams }: FilterBarProps) {
  const assignee = filters.assignee === undefined ? '' : String(filters.assignee)
  const active = Object.values(filters).some((v) => v !== undefined && v !== '') || searchText !== ''

  return (
    <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
      <label className="sr-only" htmlFor="search">
        Search title and description
      </label>
      <input
        id="search"
        className="input filters__search"
        type="search"
        placeholder="Search title or description…"
        value={searchText}
        onChange={(e) => onSearchText(e.target.value)}
      />

      <label className="sr-only" htmlFor="f-team">Team</label>
      <select id="f-team" className="select" value={filters.teamId ?? ''} onChange={(e) => onChange({ teamId: toNumber(e.target.value) })}>
        <option value="">All teams</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>

      <label className="sr-only" htmlFor="f-status">Status</label>
      <select id="f-status" className="select" value={filters.status ?? ''} onChange={(e) => onChange({ status: (e.target.value || undefined) as Status | undefined })}>
        <option value="">Any status</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
        ))}
      </select>

      <label className="sr-only" htmlFor="f-priority">Priority</label>
      <select id="f-priority" className="select" value={filters.priority ?? ''} onChange={(e) => onChange({ priority: (e.target.value || undefined) as Priority | undefined })}>
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
        ))}
      </select>

      <label className="sr-only" htmlFor="f-type">Type</label>
      <select id="f-type" className="select" value={filters.type ?? ''} onChange={(e) => onChange({ type: (e.target.value || undefined) as ItemType | undefined })}>
        <option value="">Any type</option>
        {TYPES.map((t) => (
          <option key={t} value={t}>{TYPE_LABEL[t]}</option>
        ))}
      </select>

      <label className="sr-only" htmlFor="f-assignee">Owner</label>
      <select
        id="f-assignee"
        className="select"
        value={assignee}
        onChange={(e) => {
          const v = e.target.value
          onChange({ assignee: v === '' ? undefined : v === 'me' || v === 'none' ? v : Number(v) })
        }}
      >
        <option value="">Anyone</option>
        <option value="me">Me</option>
        <option value="none">Unassigned</option>
      </select>

      {active && (
        <button type="button" className="btn btn--ghost btn--small" onClick={onClear}>
          Clear filters
        </button>
      )}
    </form>
  )
}
