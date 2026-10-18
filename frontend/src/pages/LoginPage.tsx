import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/auth-context'

const DEMO_PASSWORD = 'Password123!'

// Matches the seed data. Shown so a reviewer can try every role quickly.
const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@demo.com' },
  { label: 'Lead · Operations', email: 'lead.ops@demo.com' },
  { label: 'Lead · Payments', email: 'lead.payments@demo.com' },
  { label: 'Lead · Compliance', email: 'lead.compliance@demo.com' },
  { label: 'Lead · Customer Support', email: 'lead.support@demo.com' },
  { label: 'Member · Operations', email: 'member.ops@demo.com' },
  { label: 'Member · Payments + Support', email: 'member.payments@demo.com' },
  { label: 'Member · Compliance', email: 'member.compliance@demo.com' },
  { label: 'Member · Support (Viewer in Ops)', email: 'member.support@demo.com' },
  { label: 'Viewer · Operations', email: 'viewer@demo.com' },
]

export function LoginPage() {
  const { status, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (status === 'authenticated') return <Navigate to="/" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not log in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page page--narrow">
      <header className="banner">
        <div>
          <h1>Operations Under Pressure</h1>
          <p>Log in to create, assign, track and resolve work.</p>
        </div>
      </header>

      <div className="login-grid">
        <form className="card form" onSubmit={submit}>
          <h2>Log in</h2>
          {error && (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <section className="card" aria-labelledby="demo-title">
          <h2 id="demo-title">Demo accounts</h2>
          <p className="muted small">
            Seed data. Password for all: <code className="mono">{DEMO_PASSWORD}</code>. Pick one to fill the form.
          </p>
          <ul className="demo-list">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  className="demo-button"
                  onClick={() => {
                    setEmail(a.email)
                    setPassword(DEMO_PASSWORD)
                  }}
                >
                  <span>{a.label}</span>
                  <span className="mono muted">{a.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
