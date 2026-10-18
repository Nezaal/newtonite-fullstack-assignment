import { Link, Outlet } from 'react-router-dom'
import { useNotifications } from '../api/queries'
import { useAuth } from '../auth/auth-context'

// The yellow banner and page frame shared by every logged-in page.
export function Shell() {
  const { me, logout } = useAuth()
  const notifications = useNotifications()
  const unread = notifications.data?.meta.unreadCount ?? 0

  return (
    <div className="page">
      <header className="banner">
        <div>
          <Link to="/" className="banner__title">
            <h1>Operations Under Pressure</h1>
          </Link>
          <p>Create, assign, track and resolve work, together.</p>
        </div>
        <div className="banner__right">
          <span className="live-pill">
            <i className="live-dot" aria-hidden="true" />
            {me?.user.name}
            {me?.user.isAdmin ? ' · Admin' : ''}
          </span>
          <Link to="/" className="btn btn--ghost btn--small" aria-label={`Notifications, ${unread} unread`}>
            Notifications <span className="count">{unread}</span>
          </Link>
          <button type="button" className="btn btn--ghost btn--small" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
