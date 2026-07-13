import { useEffect, useRef, useState } from 'react'
import { useLive } from '../lib/useLive'
import { Card, Kpi } from '../components/ui'
import { fullName } from '../lib/socket'

// ---- robust date/time (attendance_time is a TIME string e.g. "11:16:07.746653",
// attendance_date is "YYYY-MM-DD" — a naive `new Date(time)` yields Invalid Date) ----
const timeOf = (e: any) => {
  const t = e?.attendance_time
  if (!t) return '—'
  if (typeof t === 'string' && !t.includes('T')) return t.slice(0, 5)          // "HH:MM"
  const d = new Date(t)
  return isNaN(+d) ? String(t).slice(0, 5) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
const dateOf = (e: any) => {
  const s = e?.attendance_date
  if (!s) return ''
  const d = new Date(String(s).length <= 10 ? `${s}T00:00:00` : s)
  return isNaN(+d) ? String(s) : d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' })
}

type Disp = { verb: string; label: string; kind: string; tone: 'ok' | 'warn' | 'violet' | 'bad' }
function display(e: any): Disp {
  const isOut = e?.check_type === 'out'
  const st = e?.status || ''
  if (!isOut) {
    return st === 'Late'
      ? { verb: 'Checked In', label: 'Late', kind: 'late', tone: 'warn' }
      : { verb: 'Checked In', label: 'On Time', kind: 'ontime', tone: 'ok' }
  }
  const m: Record<string, Disp> = {
    'Present': { verb: 'Checked Out', label: 'Complete', kind: 'ontime', tone: 'ok' },
    'Left Early': { verb: 'Checked Out', label: 'Left Early', kind: 'late', tone: 'warn' },
    'Half Day': { verb: 'Checked Out', label: 'Half Day', kind: 'late', tone: 'warn' },
    'Overtime': { verb: 'Checked Out', label: 'Overtime', kind: 'out', tone: 'violet' },
  }
  return m[st] || { verb: 'Checked Out', label: 'Checked Out', kind: 'out', tone: 'violet' }
}

const SOLID: Record<string, string> = { ok: 'bg-ok', warn: 'bg-warn', violet: 'bg-violet', bad: 'bg-bad' }
const RING: Record<string, string> = { ok: 'ring-ok', warn: 'ring-warn', violet: 'ring-violet', bad: 'ring-bad' }
const CHIP: Record<string, string> = { ok: 'bg-ok/15 text-ok', warn: 'bg-warn/15 text-warn', violet: 'bg-violet/15 text-violet', bad: 'bg-bad/15 text-bad' }
const AVA = ['#5b8cff', '#27d796', '#ffb454', '#9b7bff', '#ff5c7a', '#42c6e0']

// Face: large, square, shows the WHOLE face (object-cover fills the frame); falls
// back to a bold monogram tile if the snapshot is missing/broken.
function Face({ src, name }: { src?: string | null; name: string }) {
  const [err, setErr] = useState(false)
  if (src && !err)
    return <img src={src} onError={() => setErr(true)} alt={name}
      className="w-full aspect-square object-cover bg-line" />
  const color = AVA[Math.abs([...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0)) % AVA.length]
  return <div style={{ background: color }} className="w-full aspect-square grid place-items-center text-white text-5xl font-black">{(name || '?')[0].toUpperCase()}</div>
}

function PersonCard({ e, fresh }: { e: any; fresh: boolean }) {
  const d = display(e)
  return (
    <div className={`card p-0 overflow-hidden transition ${fresh ? `ring-4 ${RING[d.tone]} animate-in shadow-lg` : 'opacity-95'}`}>
      <div className="relative">
        <Face src={e.image_url} name={fullName(e)} />
        {fresh && (
          <div className={`absolute top-2.5 right-2.5 w-10 h-10 rounded-full grid place-items-center text-white text-xl font-black ring-4 ring-surface ${SOLID[d.tone]}`}>✓</div>
        )}
        <div className={`absolute inset-x-0 bottom-0 h-2 ${SOLID[d.tone]}`} />
      </div>
      <div className="p-3.5">
        <div className="font-extrabold text-xl leading-tight truncate">{fullName(e)}</div>
        <div className="text-xs text-muted mt-0.5 truncate">ID {e.emp_id} · {e.camera_name || 'camera'}</div>
        <div className="flex items-center justify-between mt-2.5">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${CHIP[d.tone]}`}>{d.verb} · {d.label}</span>
          <span className="text-lg font-extrabold tabular-nums">{timeOf(e)}</span>
        </div>
      </div>
    </div>
  )
}

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return (
    <div className="text-right leading-none">
      <div className="text-3xl font-extrabold tabular-nums">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      <div className="text-xs text-muted mt-1">{now.toLocaleDateString([], { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}</div>
    </div>
  )
}

export default function LiveBoard() {
  const { entries, stats, connected } = useLive()

  // Mark entries that arrive via the live socket (after the initial load) as
  // "fresh" for 25s so a GROUP marked together all light up at once.
  const [fresh, setFresh] = useState<Record<string, number>>({})
  const seen = useRef<Set<string>>(new Set())
  const inited = useRef(false)
  useEffect(() => {
    if (!entries.length) return
    if (!inited.current) { entries.forEach((e) => seen.current.add(String(e.id))); inited.current = true; return }
    const now = Date.now(); const add: Record<string, number> = {}
    for (const e of entries) { const id = String(e.id); if (!seen.current.has(id)) { seen.current.add(id); add[id] = now } }
    if (Object.keys(add).length) setFresh((f) => ({ ...f, ...add }))
  }, [entries])
  useEffect(() => {
    const t = setInterval(() => setFresh((f) => {
      const now = Date.now(); const n = Object.fromEntries(Object.entries(f).filter(([, ts]) => now - ts < 25000))
      return Object.keys(n).length === Object.keys(f).length ? f : n
    }), 1000)
    return () => clearInterval(t)
  }, [])
  const isFresh = (e: any) => !!fresh[String(e.id)]

  const fullscreen = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()

  const s = stats || {}
  const today = entries[0] ? dateOf(entries[0]) : ''
  const checkedOut = new Set(entries.filter((e) => e.check_type === 'out').map((e) => e.emp_id)).size
  const shown = entries.slice(0, 16)

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold">Live Attendance {today && <span className="text-muted font-medium text-sm">· {today}</span>}</h1>
          <div className="flex items-center gap-2 text-sm mt-0.5">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-ok animate-pulse' : 'bg-muted'}`} />
            <span className={connected ? 'text-ok' : 'text-muted'}>{connected ? 'Live — confirming check-ins in real time' : 'Reconnecting…'}</span>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <Clock />
          <button className="btn" onClick={fullscreen} title="Kiosk / full screen">⛶ Full screen</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Present Today" value={s.total_present_today ?? 0} accent="brand" foot="checked in" />
        <Kpi label="On Time" value={s.total_on_time_today ?? 0} accent="ok" foot="today" />
        <Kpi label="Late" value={s.total_late_today ?? 0} accent="warn" foot="today" />
        <Kpi label="Checked Out" value={checkedOut} accent="violet" foot="today" />
      </div>

      <Card title="Marked employees" right={<span className={`text-xs ${connected ? 'text-ok' : 'text-muted'}`}>● {connected ? 'live' : 'offline'}</span>}>
        {shown.length ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))' }}>
            {shown.map((e, i) => <PersonCard key={e.id || i} e={e} fresh={isFresh(e)} />)}
          </div>
        ) : (
          <div className="py-14 grid place-items-center text-center">
            <div className="w-16 h-16 rounded-full grid place-items-center bg-surface2 text-2xl mb-3">◉</div>
            <div className="text-lg font-semibold">Waiting for the next check-in…</div>
            <div className="text-sm text-muted mt-1">Walk up to a camera — your photo, name and time appear here the moment you're recognized.</div>
          </div>
        )}
      </Card>
    </div>
  )
}
