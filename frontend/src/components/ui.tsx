import { ReactNode, useEffect, useState } from 'react'

const PALETTE = ['#5b8cff', '#27d796', '#ffb454', '#9b7bff', '#ff5c7a', '#42c6e0']
const colorFor = (s: string) => PALETTE[Math.abs([...(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0)) % PALETTE.length]

export function Avatar({ src, name, size = 40 }: { src?: string | null; name?: string; size?: number }) {
  const [err, setErr] = useState(false)
  const initial = (name || '?')[0].toUpperCase()
  if (src && !err)
    return <img src={src} onError={() => setErr(true)} style={{ width: size, height: size }}
      className="rounded-full object-cover bg-line shrink-0" />
  return <div style={{ width: size, height: size, background: colorFor(name || '?') }}
    className="rounded-full grid place-items-center text-white font-bold shrink-0">{initial}</div>
}

export function Card({ title, right, children, className = '' }: { title?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`card p-5 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

export function Kpi({ label, value, foot, accent = 'brand' }: { label: string; value: ReactNode; foot?: string; accent?: string }) {
  return (
    <div className="card p-5 relative overflow-hidden">
      <div className={`absolute -right-6 -top-6 w-20 h-20 rounded-full opacity-[.14] bg-${accent}`} />
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-3xl font-extrabold mt-1 tabular-nums">{value}</div>
      {foot && <div className="text-xs text-muted mt-0.5">{foot}</div>}
    </div>
  )
}

export function Badge({ kind = 'in', children }: { kind?: string; children: ReactNode }) {
  const map: Record<string, string> = {
    in: 'bg-ok/15 text-ok', ontime: 'bg-ok/15 text-ok', out: 'bg-violet/15 text-violet',
    late: 'bg-warn/15 text-warn', exit: 'bg-violet/15 text-violet',
  }
  return <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${map[kind] || 'bg-surface2 text-muted'}`}>{children}</span>
}

export function RoleChip({ role }: { role: string }) {
  const map: Record<string, string> = {
    super_admin: 'bg-bad/15 text-bad', admin: 'bg-brand/15 text-brand',
    manager: 'bg-violet/15 text-violet', viewer: 'bg-ok/15 text-ok',
  }
  return <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${map[role] || 'bg-surface2 text-muted'}`}>{role}</span>
}

export function Spinner() {
  return <div className="grid place-items-center py-16"><div className="w-8 h-8 border-2 border-line border-t-brand rounded-full animate-spin" /></div>
}

// ---- toasts ----
interface T { id: number; msg: string; kind: string }
let _push: (t: Omit<T, 'id'>) => void = () => {}
export const toast = (msg: string, kind = '') => _push({ msg, kind })
export function Toaster() {
  const [items, setItems] = useState<T[]>([])
  useEffect(() => {
    _push = (t) => {
      const id = Date.now() + Math.random()
      setItems((x) => [...x, { ...t, id }])
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4000)
    }
  }, [])
  const border: Record<string, string> = { ok: 'border-l-ok', warn: 'border-l-warn', err: 'border-l-bad' }
  return (
    <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-[60]">
      {items.map((i) => (
        <div key={i.id} className={`card px-4 py-3 border-l-4 ${border[i.kind] || 'border-l-brand'} animate-in min-w-[240px]`}>{i.msg}</div>
      ))}
    </div>
  )
}
