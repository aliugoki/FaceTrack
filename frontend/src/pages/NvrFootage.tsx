import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { api } from '../lib/api'
import { Card, Spinner, toast } from '../components/ui'
import { HLS_PORT } from '../lib/streams'

// Browse recorded footage straight off the NVR (Hikvision ISAPI search), watch a
// window in the browser via an on-demand RTSP->HLS proxy (MediaMTX), and queue
// inference on any window — the "advanced offline features" surfaced for operators.

const pad = (n: number) => String(n).padStart(2, '0')
// A Date -> value for <input type="datetime-local"> (local wall-clock).
const toInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const fmt = (s?: string) => (s ? s.replace('T', ' ').slice(0, 19) : '—')
const hlsSrc = (path: string) => {
  const { protocol, hostname } = window.location
  return `${protocol}//${hostname}:${HLS_PORT}/${path}/index.m3u8`
}

function PlaybackPlayer({ path }: { path: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const src = hlsSrc(path)
    let player: Hls | null = null
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = src
    } else if (Hls.isSupported()) {
      player = new Hls()
      player.loadSource(src)
      player.attachMedia(v)
    }
    return () => {
      if (player) player.destroy()
      // Best-effort teardown of the on-demand proxy path (idle-close backs it up).
      api(`/api/pipeline/nvr/play/${path}`, { method: 'DELETE' }).catch(() => {})
    }
  }, [path])
  return <video ref={ref} className="w-full rounded-lg bg-black" controls autoPlay playsInline />
}

export default function NvrFootage() {
  const [companies, setCompanies] = useState<any[]>([])
  const [company, setCompany] = useState('')
  const [cams, setCams] = useState<any[]>([])
  const [cam, setCam] = useState<number | ''>('')
  const now = new Date()
  const [start, setStart] = useState(toInput(new Date(now.getTime() - 3600_000)))
  const [end, setEnd] = useState(toInput(now))
  const [res, setRes] = useState<any>(null)   // { searched, error, segments } | null
  const [busy, setBusy] = useState(false)
  const [playPath, setPlayPath] = useState<string | null>(null)

  const loadCams = (comp: string) => {
    setCams([]); setCam('')
    api(`/api/pipeline/cameras?company=${encodeURIComponent(comp)}`).then((cs: any) => {
      const withNvr = cs.filter((c: any) => c.nvr_configured)
      setCams(withNvr); if (withNvr.length) setCam(withNvr[0].id)
    }).catch(() => {})
  }
  useEffect(() => {
    api('/api/companies').then((cs: any) => {
      setCompanies(cs)
      if (cs.length) { setCompany(cs[0].admin_username); loadCams(cs[0].admin_username) }
    }).catch(() => setCompanies([]))
  }, [])

  const search = async () => {
    if (!cam || !start || !end) { toast('Pick a camera and a time range', 'err'); return }
    setBusy(true); setRes(null)
    try {
      const r = await api(`/api/pipeline/nvr/recordings?camera_id=${cam}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
      setRes(r)
      if (!r.searched) toast(`NVR search unavailable — you can still play / reprocess the window. (${r.error || ''})`, 'err')
    } catch (e: any) { toast(e.message || 'Search failed', 'err') }
    finally { setBusy(false) }
  }
  const play = async (s: string, e: string) => {
    if (!cam) return
    setPlayPath(null)
    try {
      const r = await api('/api/pipeline/nvr/play', { method: 'POST', body: { camera_id: Number(cam), start: s, end: e } })
      setPlayPath(r.path)
    } catch (err: any) { toast(err.message || 'Could not start playback', 'err') }
  }
  const infer = async (s: string, e: string) => {
    if (!cam) return
    if (!confirm(`Run inference on this window?\n${fmt(s)} → ${fmt(e)}`)) return
    try {
      await api('/api/pipeline/backfill', { method: 'POST', body: { camera_id: Number(cam), start: s, end: e } })
      toast('Queued — the window will be reprocessed from the NVR', 'ok')
    } catch (err: any) { toast(err.message || 'Failed', 'err') }
  }

  const segs: any[] = res?.segments || []

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <Card title="Browse NVR footage" className="lg:col-span-1">
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] text-muted block mb-1">Company</label>
            <select className="input w-full" value={company}
              onChange={(e) => { setCompany(e.target.value); loadCams(e.target.value) }}>
              {companies.map((c) => <option key={c.admin_username} value={c.admin_username}>{c.company_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-1">Camera (NVR-configured)</label>
            <select className="input w-full" value={cam} onChange={(e) => setCam(Number(e.target.value))}>
              {!cams.length && <option value="">No NVR cameras</option>}
              {cams.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted block mb-1">From</label>
              <input className="input w-full" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-1">To</label>
              <input className="input w-full" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn flex-1" disabled={busy || !cam} onClick={search}>{busy ? 'Searching…' : '⌕ Search'}</button>
            <button className="btn" disabled={!cam} onClick={() => play(start, end)} title="Play this whole window">▶ Play</button>
            <button className="btn bg-brand/20 text-brand border-brand" disabled={!cam} onClick={() => infer(start, end)} title="Run inference on this whole window">⟳</button>
          </div>
          <p className="text-[11px] text-muted">Playback streams the recorded window off the NVR (on-demand RTSP→HLS). <b>⟳</b> queues inference on the window (high-speed reprocess, attendance stamped at the true time).</p>
        </div>
      </Card>

      <div className="lg:col-span-2 flex flex-col gap-4">
        <Card title={playPath ? 'Playing recorded footage' : 'Player'}>
          {playPath
            ? <PlaybackPlayer key={playPath} path={playPath} />
            : <p className="text-muted text-sm">Search for footage, then <b>▶ Play</b> a segment or the whole window.</p>}
        </Card>

        <Card title="Recorded segments" right={res ? <span className="text-xs text-muted">{res.searched ? `${segs.length} found` : 'search unavailable'}</span> : null}>
          {!res ? <p className="text-muted text-sm">Run a search to list the segments the NVR holds for this window.</p>
            : !res.searched ? (
              <p className="text-muted text-sm">The NVR didn't return a segment list ({res.error || 'unsupported'}). You can still <b>▶ Play</b> and <b>⟳</b> the requested window using the controls on the left.</p>
            ) : !segs.length ? <p className="text-muted text-sm">No recorded segments in this window.</p> : (
              <table className="w-full text-sm">
                <thead className="bg-surface2 text-muted"><tr>{['From', 'To', ''].map((h) => <th key={h} className="text-left px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {segs.map((g, i) => (
                    <tr key={i} className="border-b border-line/50">
                      <td className="px-3 py-2 tabular-nums">{fmt(g.start)}</td>
                      <td className="px-3 py-2 tabular-nums">{fmt(g.end)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button className="btn py-1 text-xs mr-2" onClick={() => play(g.start, g.end)}>▶ Play</button>
                        <button className="btn py-1 text-xs bg-brand/20 text-brand border-brand" onClick={() => infer(g.start, g.end)}>⟳ Send to inference</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </Card>
      </div>
    </div>
  )
}
