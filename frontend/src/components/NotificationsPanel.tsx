import { Link } from 'react-router-dom'
import { useMarkRead } from '../api/mutations'
import { useNotifications } from '../api/queries'
import { formatDateTime } from '../lib/format'
import { Tag } from './Tag'

export function NotificationsPanel() {
  const { data, isLoading, isError, refetch } = useNotifications()
  const markRead = useMarkRead()
  const unread = data?.meta.unreadCount ?? 0

  return (
    <aside className="card panel" aria-labelledby="notifications-title">
      <div className="panel__head">
        <h2 id="notifications-title">Notifications</h2>
        <Tag tone="plain">{unread} new</Tag>
      </div>
      <div className="panel__body">
        {isLoading && <p className="muted">Loading…</p>}
        {isError && (
          <p role="alert">
            Could not load notifications.{' '}
            <button type="button" className="link-button" onClick={() => void refetch()}>Try again</button>
          </p>
        )}
        {data && data.data.length === 0 && <p className="muted">Nothing yet. You will be told when work is assigned to you or needs your approval.</p>}
        <ol className="timeline">
          {data?.data.map((n) => (
            <li key={n.id} className="timeline__item">
              <i className={`timeline__dot${n.isRead ? '' : ' timeline__dot--new'}`} aria-hidden="true" />
              <div className="timeline__meta">
                <span className="mono">{formatDateTime(n.createdAt)}</span>
                {!n.isRead && <Tag tone="yellow">NEW</Tag>}
              </div>
              <Link to={`/items/${n.item.id}`} className="bubble bubble--link" onClick={() => !n.isRead && markRead.mutate(n.id)}>
                {n.message}
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  )
}
