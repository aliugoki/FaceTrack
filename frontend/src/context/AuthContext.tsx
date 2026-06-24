import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { api, setToken, clearToken, getToken } from '../lib/api'

export interface Me { company_name: string; role: string; permissions: string[]; webrtc_url?: string }

interface AuthCtx {
  me: Me | null
  loading: boolean
  login: (u: string, p: string) => Promise<void>
  logout: () => Promise<void>
  can: (perm: string) => boolean
}

const Ctx = createContext<AuthCtx>(null as any)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try { setMe(await api<Me>('/api/auth/me')) } catch { clearToken() }
      }
      setLoading(false)
    })()
  }, [])

  const login = async (username: string, password: string) => {
    const r = await api<{ token: string }>('/api/auth/login', { method: 'POST', body: { username, password } })
    setToken(r.token)
    setMe(await api<Me>('/api/auth/me'))
  }
  const logout = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }) } catch {}
    clearToken(); setMe(null)
  }
  const can = (perm: string) => !!me?.permissions?.includes(perm)

  return <Ctx.Provider value={{ me, loading, login, logout, can }}>{children}</Ctx.Provider>
}
