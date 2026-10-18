import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/auth-context'
import { Shell } from './components/Shell'
import { DashboardPage } from './pages/DashboardPage'
import { ItemPage } from './pages/ItemPage'
import { LoginPage } from './pages/LoginPage'

// Pages behind login. Real access control is on the server; this just sends visitors to the login page.
function RequireLogin() {
  const { status } = useAuth()
  if (status === 'loading') return <p className="card empty page page--narrow">Loading…</p>
  if (status === 'anonymous') return <Navigate to="/login" replace />
  return <Shell />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireLogin />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/items/:id" element={<ItemPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
