import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiData, AUTH_EXPIRED_EVENT, getToken, setToken } from '../api/client'
import { keys, useMe } from '../api/queries'
import type { Me } from '../api/types'
import { useToast } from '../components/toast-context'
import { AuthContext, type AuthState } from './auth-context'

interface LoginResult {
  token: string
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [hasToken, setHasToken] = useState(() => getToken() !== null)
  const meQuery = useMe(hasToken)

  const logout = useCallback(() => {
    setToken(null)
    setHasToken(false)
    queryClient.clear() // never show the next person the previous person's data
  }, [queryClient])

  // The server said our token is no good (expired or user removed).
  useEffect(() => {
    const onExpired = () => {
      logout()
      toast.error('Your session ended. Please log in again.')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [logout, toast])

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await apiData<LoginResult>('/auth/login', { method: 'POST', body: { email, password } })
      setToken(result.token)
      queryClient.clear()
      setHasToken(true)
      await queryClient.fetchQuery({ queryKey: keys.me, queryFn: () => apiData<Me>('/me') })
    },
    [queryClient],
  )

  const me = hasToken ? (meQuery.data ?? null) : null
  const status: AuthState['status'] = !hasToken ? 'anonymous' : me ? 'authenticated' : meQuery.isError ? 'anonymous' : 'loading'

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      login,
      logout,
      roleIn: (teamId) => me?.teams.find((t) => t.id === teamId)?.role ?? null,
    }),
    [status, me, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
