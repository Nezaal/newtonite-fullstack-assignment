import { Link } from 'react-router-dom'
import { useClaim } from '../api/mutations'
import type { ItemSummary } from '../api/types'
import { useAuth } from '../auth/auth-context'
import { formatDate, formatDateTime, isOverdue, TYPE_LABEL } from '../lib/format'
import { PriorityMark, StatusTag, Tag } from './Tag'

export function ItemCard({ item }: { item: ItemSummary }) {
  const { roleIn } = useAuth()
  const claim = useClaim(item.id)
  const role = roleIn(item.team.id)
  // Convenience only: the server checks the role again when you press the button.
  const canClaim = role !== null && role !== 'VIEWER' && item.assignee === null && item.status === 'OPEN'

  return (
    <article className="card item-card">
      <div className="item-card__top">
        <div className="tags">
          <Tag>{TYPE_LABEL[item.type]}</Tag>
          <Tag>{item.team.name}</Tag>
        </div>
        <PriorityMark priority={item.priority} />
      </div>

      <h3 className="item-card__title">
        <Link to={`/items/${item.id}`}>{item.title}</Link>
      </h3>
      <StatusTag status={item.status} />

      <dl className="meta">
        <div>
          <dt>Owner</dt>
          <dd>{item.assignee?.name ?? 'Unassigned'}</dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd className={isOverdue(item) ? 'is-overdue' : ''}>
            {item.dueDate ? formatDate(item.dueDate) : '–'}
            {isOverdue(item) ? ' · overdue' : ''}
          </dd>
        </div>
      </dl>

      <div className="item-card__foot">
        <span className="mono muted">{formatDateTime(item.updatedAt)}</span>
        <div className="actions">
          {canClaim && (
            <button type="button" className="btn btn--primary btn--small" disabled={claim.isPending} onClick={() => claim.mutate()}>
              {claim.isPending ? 'Claiming…' : 'Claim'}
            </button>
          )}
          <Link to={`/items/${item.id}`} className="btn btn--ghost btn--small">
            Open
          </Link>
        </div>
      </div>
    </article>
  )
}
