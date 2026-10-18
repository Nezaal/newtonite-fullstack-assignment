import { createContext, useContext } from 'react'
import type { Me, Role } from '../api/types'

export interface AuthState {
  // 'loading' while we check a saved login
  status: 'loading' | 'anonymous' | 'authenticated'
  me: Me | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  // The user's role in a team (admins count as Lead everywhere). null = no access.
  roleIn: (teamId: number) => Role | null
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const state = useContext(AuthContext)
  if (!state) throw new Error('useAuth must be used inside <AuthProvider>')
  return state
}
