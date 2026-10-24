import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as authApi from '../api/authApi'
import { getErrorStatus } from '../api/axios'
import type { User } from '../api/authApi'

interface AuthState {
  user: User | null
  loading: boolean
  aiAvailable: boolean
  /** Combined upload limit set by the host, or null when only the per-file limit applies. */
  uploadTotalMb: number | null
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  deleteAccount: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [aiAvailable, setAiAvailable] = useState(false)
  const [uploadTotalMb, setUploadTotalMb] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const me = await authApi.fetchMe()
        if (!cancelled) setUser(me)
      } catch (err) {
        if (getErrorStatus(err) !== 401) console.warn('Could not restore session')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!user) return
    authApi.fetchConfig().then(
      (c) => {
        setAiAvailable(c.aiAvailable)
        setUploadTotalMb(c.uploadTotalMb ?? null)
      },
      () => setAiAvailable(false),
    )
  }, [user])

  const login = useCallback(async (email: string, password: string) => setUser(await authApi.login({ email, password })), [])
  const register = useCallback(
    async (name: string, email: string, password: string) => setUser(await authApi.register({ name, email, password })),
    [],
  )
  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
    }
  }, [])
  const deleteAccount = useCallback(async () => {
    await authApi.deleteAccount()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, aiAvailable, uploadTotalMb, login, register, logout, deleteAccount }),
    [user, loading, aiAvailable, uploadTotalMb, login, register, logout, deleteAccount],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
