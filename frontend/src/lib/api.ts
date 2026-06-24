const TOKEN_KEY = 'ft_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

export async function api<T = any>(path: string, opts: any = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers || {}) }
  const t = getToken()
  if (t) headers['Authorization'] = `Bearer ${t}`
  if (opts.body && typeof opts.body !== 'string') {
    headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(opts.body)
  }
  const res = await fetch(path, { ...opts, headers })
  if (res.status === 401) {
    clearToken()
    if (!location.pathname.endsWith('/login')) location.assign('/login')
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.detail || res.statusText)
  }
  return res.status === 204 ? (null as T) : res.json()
}
