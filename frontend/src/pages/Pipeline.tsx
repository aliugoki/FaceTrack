import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { Card, Kpi, Spinner, toast } from '../components/ui'

// ── helpers ─────────────────────────────────────────────────────────────────
const fmtDur = (s?: number | null) => {
  if (s == null) return '—'
  const n = Math.floor(s)
  if (n < 60) return `${n}s`
  if (n < 3600) return `${Math.floor(n / 60)}m ${n % 60}s`
  return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`
}

const STATE_UI: Record<string, { label: string; cls: string; dot: string; pulse?: boolean }> = {
  healthy: { label: 'Healthy', cls: 'bg-ok/15 text-ok', dot: 'bg-ok' },
  degraded: { label: 'Degraded', cls: 'bg-warn/15 text-warn', dot: 'bg-warn', pulse: true },
  starting: { label: 'Starting', cls: 'bg-brand/15 text-brand', dot: 'bg-brand', pulse: true },
  stopped: { label: 'Stopped', cls: 'bg-surface2 text-muted', dot: 'bg-line' },
  unknown: { label: 'Unknown', cls: 'bg-surface2 text-muted', dot: 'bg-line' },
}

function StateBadge({ state }: { state: string }) {
  const u = STATE_UI[state] || STATE_UI.unknown
  return (
    <span className={`inline-flex items-center gap-2 text-[11px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${u.cls}`}>
      <span className={`w-2 h-2 rounded-full ${u.dot} ${u.pulse ? 'animate-pulse' : ''}`} />{u.label}
    </span>
  )
}

function Meter({ label, used, total, unit, accent }: { label: string; used: number; total: number; unit: string; accent: string }) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0
  return (
    <div>
      <div className="flex justify-between text-[11px] text-muted mb-1">
        <span>{label}</span><span className="tabular-nums">{used}{total ? `/${total}` : ''} {unit} · {pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-surface2 overflow-hidden">
        <div className={`h-full rounded-full bg-${accent}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── per-source health table (drill-down) ────────────────────────────────────
function SourceTable({ index }: { index: number }) {
  const [h, setH] = useState<any>(null)
  useEffect(() => {
    let on = true
    const load = () => api(`/api/pipeline/health/${index}`).then((d) => on && setH(d)).catch(() => {})
    load(); const t = setInterval(load, 4000); return () => { on = false; clearInterval(t) }
  }, [index])
  if (!h) return <Spinner />
  if (!h.available) return <p className="text-muted text-sm">No live health on :{h.health_port} — pipeline not running on this index.</p>
  if (!h.sources?.length) return <p className="text-muted text-sm">Pipeline {h.pipeline_state} · uptime {fmtDur(h.uptime_sec)} · no sources reported.</p>
  return (
    <table className="w-full text-sm">
      <thead className="bg-surface2 text-muted">
        <tr>{['Source', 'Frames', 'Since frame', 'Reconnects', 'Errors', 'State'].map((x) => <th key={x} className="text-left px-3 py-2 font-semibold">{x}</th>)}</tr>
      </thead>
      <tbody>
        {h.sources.map((s: any) => (
          <tr key={s.idx} className="border-b border-line/50">
            <td className="px-3 py-2 font-medium">{s.id}</td>
            <td className="px-3 py-2 tabular-nums">{s.frames?.toLocaleString?.() ?? s.frames}</td>
            <td className={`px-3 py-2 tabular-nums ${s.stale ? 'text-bad font-semibold' : 'text-muted'}`}>{s.seconds_since_frame}s</td>
            <td className="px-3 py-2 tabular-nums">{s.reconnects}</td>
            <td className={`px-3 py-2 tabular-nums ${s.errors ? 'text-warn' : ''}`}>{s.errors}</td>
            <td className="px-3 py-2">{s.stale
              ? <span className="text-[11px] font-bold text-bad">● STALE</span>
              : <span className="text-[11px] font-bold text-ok">● LIVE</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── one pipeline (company) card ─────────────────────────────────────────────
function PipelineCard({ p, onAction }: { p: any; onAction: (company: string, action: string, index: number) => void }) {
  const [idx, setIdx] = useState<number>(p.index ?? 0)
  const [open, setOpen] = useState(false)
  const running = ['healthy', 'degraded', 'starting'].includes(p.state)
  const cont = p.container

  const act = (action: string) => {
    if ((action === 'stop' || action === 'restart') &&
        !confirm(`${action === 'stop' ? 'Stop' : 'Restart'} the pipeline for ${p.company} (index ${idx})?`)) return
    onAction(p.admin_username, action, idx)
  }

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{p.company}</div>
          <div className="text-[11px] text-muted">{p.admin_username} · idx {p.index} · rtsp {p.rtsp_port} · health {p.health_port}</div>
        </div>
        <StateBadge state={p.state} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-surface2 rounded-lg py-2">
          <div className="text-lg font-extrabold tabular-nums">{p.live_sources ?? '—'}<span className="text-muted text-sm font-normal">/{p.total_sources ?? p.configured_cameras}</span></div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Cameras live</div>
        </div>
        <div className="bg-surface2 rounded-lg py-2">
          <div className="text-lg font-extrabold tabular-nums">{fmtDur(p.uptime_sec)}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Uptime</div>
        </div>
        <div className="bg-surface2 rounded-lg py-2">
          <div className={`text-lg font-extrabold tabular-nums ${p.stale_sources ? 'text-bad' : ''}`}>{p.stale_sources ?? 0}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Stale feeds</div>
        </div>
      </div>

      {cont && <div className="text-[11px] text-muted">container <b className={cont.state === 'running' ? 'text-ok' : 'text-muted'}>{cont.state}</b> · {cont.status}</div>}

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[11px] text-muted">idx</label>
        <input className="input w-16 py-1" type="number" min={0} value={idx} onChange={(e) => setIdx(Number(e.target.value))} />
        {!running
          ? <button className="btn py-1.5 bg-ok/20 text-ok border-ok" onClick={() => act('start')}>▶ Start</button>
          : <button className="btn py-1.5" onClick={() => act('restart')}>⟳ Restart</button>}
        {running && <button className="btn py-1.5 text-bad" onClick={() => act('stop')}>■ Stop</button>}
        <button className="btn py-1.5 ml-auto" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Details'}</button>
      </div>

      {open && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <SourceTable index={p.index} />
          {cont?.log && (
            <details>
              <summary className="text-xs text-muted cursor-pointer">Container logs ({cont.name})</summary>
              <pre className="bg-surface2 border border-line rounded-lg p-2 text-[11px] overflow-auto max-h-56 whitespace-pre-wrap mt-2">{cont.log}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// ── main page ───────────────────────────────────────────────────────────────
export default function Pipeline() {
  const [fleet, setFleet] = useState<any>(null)
  const [companies, setCompanies] = useState<any[]>([])
  const [jobs, setJobs] = useState<any[]>([])
  // provisioning
  const [pc, setPc] = useState('')          // provision company (admin_username)
  const [pIdx, setPIdx] = useState(0)
  const [d, setD] = useState<any>(null)
  const firstLoad = useRef(true)

  const loadFleet = () => api('/api/pipeline/status').then((f) => { setFleet(f); firstLoad.current = false }).catch(() => {})
  const loadJobs = () => api('/api/pipeline/jobs').then(setJobs).catch(() => {})
  const provision = (comp = pc, i = pIdx) => {
    if (!comp) return
    setD(null)
    api(`/api/pipeline/provision?company=${encodeURIComponent(comp)}&index=${i}`).then(setD).catch(() => {})
  }

  useEffect(() => {
    api('/api/companies').then((cs: any) => {
      setCompanies(cs)
      if (cs.length) { setPc(cs[0].admin_username); provision(cs[0].admin_username, 0) }
    }).catch(() => {})
    loadFleet(); loadJobs()
    const t = setInterval(() => { loadFleet(); loadJobs() }, 5000)
    return () => clearInterval(t)
  }, [])

  const doAction = async (company: string, action: string, index: number) => {
    try {
      await api('/api/pipeline/launch', { method: 'POST', body: { company, action, index } })
      toast(`Queued ${action} for ${company} (idx ${index})`, 'ok'); loadJobs()
    } catch (e: any) { toast(e.message || 'Failed', 'err') }
  }
  const copy = (t: string) => { navigator.clipboard?.writeText(t); toast('Copied', 'ok') }
  const download = () => {
    const b = new Blob([d.config], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = d.config_filename; a.click()
  }

  if (!fleet && firstLoad.current) return <Spinner />
  const agent = fleet?.agent
  const sum = fleet?.summary || { total: 0, running: 0, cameras_live: 0 }
  const gpu = agent?.gpus?.[0]

  return (
    <div className="flex flex-col gap-4">
      {/* ── summary band ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Active pipelines" value={`${sum.running}/${sum.total}`} accent="ok" foot="running / total" />
        <Kpi label="Cameras live" value={sum.cameras_live} accent="brand" foot="frames flowing" />
        <Kpi label="Host agent" value={agent?.online ? 'Online' : 'Offline'} accent={agent?.online ? 'ok' : 'bad'}
          foot={agent?.last_seen ? `seen ${fmtDur(agent.age_sec)} ago` : 'never connected'} />
        <Kpi label="GPU" value={gpu ? `${gpu.util}%` : 'n/a'} accent="violet"
          foot={gpu ? `${gpu.name} · ${gpu.temp}°C` : 'no telemetry'} />
      </div>

      {/* ── agent offline warning ── */}
      {!agent?.online && (
        <div className="card p-4 border-l-4 border-l-warn flex items-start gap-3">
          <span className="text-xl">⚠</span>
          <div className="text-sm">
            <b>Host agent is offline.</b> Start/Stop/Restart won't run and container/GPU info is unavailable.
            Run it on the GPU host: <code className="bg-surface2 px-1.5 py-0.5 rounded">AGENT_TOKEN=… python3 tools/pipeline_agent.py</code>.
            <span className="text-muted"> Live health below still works for any pipeline that is already running.</span>
          </div>
        </div>
      )}

      {/* ── GPU detail ── */}
      {gpu && (
        <Card title={`GPU · ${gpu.name}`} right={<span className="text-xs text-muted">{gpu.temp}°C · util {gpu.util}%</span>}>
          <div className="grid md:grid-cols-2 gap-4">
            <Meter label="Memory" used={gpu.mem_used} total={gpu.mem_total} unit="MB" accent={gpu.mem_used / gpu.mem_total > 0.85 ? 'bad' : 'violet'} />
            <Meter label="Utilisation" used={gpu.util} total={100} unit="%" accent={gpu.util > 90 ? 'warn' : 'brand'} />
          </div>
          <p className="text-xs text-muted mt-3">RTX-class 8&nbsp;GB ≈ 1–2 companies concurrently — watch memory before launching more.</p>
        </Card>
      )}

      {/* ── fleet ── */}
      <Card title="Pipelines" right={<span className="text-xs text-muted">live · auto-refreshes 5s</span>}>
        {!fleet?.pipelines?.length ? <p className="text-muted text-sm">No companies found.</p> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {fleet.pipelines.map((p: any) => <PipelineCard key={p.admin_username} p={p} onAction={doAction} />)}
          </div>
        )}
      </Card>

      {/* ── provisioning ── */}
      <Card title="Provision config"
        right={<div className="flex gap-2 items-center flex-wrap">
          <select className="input" value={pc} onChange={(e) => { setPc(e.target.value); provision(e.target.value, pIdx) }}>
            {companies.map((c) => <option key={c.admin_username} value={c.admin_username}>{c.company_name}</option>)}
          </select>
          <label className="text-xs text-muted">Index</label>
          <input className="input w-20" type="number" min={0} value={pIdx} onChange={(e) => setPIdx(Number(e.target.value))} />
          <button className="btn" onClick={() => provision()}>Apply</button>
        </div>}>
        {!d ? <Spinner /> : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <Kpi label="Company" value={d.company} />
              <Kpi label="Cameras" value={d.camera_count} accent="ok" />
              <Kpi label="RTSP port" value={d.rtsp_port} accent="violet" />
              <Kpi label="Health port" value={d.health_port} accent="warn" />
            </div>
            <div className="mt-4 bg-surface2 border border-line rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
              <code className="text-sm break-all">{d.launch_command}</code>
              <div className="flex gap-2">
                <button className="btn" onClick={() => copy(d.launch_command)}>Copy</button>
                <button className="btn" onClick={() => copy(d.config)}>Copy config</button>
                <button className="btn" onClick={download}>⭳ {d.config_filename}</button>
              </div>
            </div>
            <details className="mt-3">
              <summary className="text-xs text-muted cursor-pointer">Show generated config</summary>
              <pre className="bg-surface2 border border-line rounded-lg p-3 text-xs overflow-auto max-h-[44vh] whitespace-pre mt-2">{d.config}</pre>
            </details>
            <p className="text-xs text-muted mt-2">Give each company a <b>distinct index</b> so ports don't collide. Launch from a pipeline card above (queued to the host agent — the dashboard never runs docker).</p>
          </>
        )}
      </Card>

      {/* ── jobs history ── */}
      <Card title="Launch jobs" right={<span className="text-xs text-muted">via host agent · auto-refreshes</span>}>
        {!jobs.length ? <p className="text-muted text-sm">No launch jobs yet.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-surface2 text-muted"><tr>{['#', 'Company', 'Action', 'Idx', 'Status', 'When', 'Log'].map((h) => <th key={h} className="text-left px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {jobs.map((j) => {
                const c = j.status === 'done' ? 'text-ok' : j.status === 'failed' ? 'text-bad' : j.status === 'running' ? 'text-brand' : 'text-muted'
                return (
                  <tr key={j.id} className="border-b border-line/50">
                    <td className="px-3 py-2 text-muted">{j.id}</td>
                    <td className="px-3 py-2">{j.company}</td>
                    <td className="px-3 py-2">{j.action}</td>
                    <td className="px-3 py-2">{j.index}</td>
                    <td className={`px-3 py-2 font-semibold ${c}`}>{j.status}</td>
                    <td className="px-3 py-2 text-muted">{j.updated_at ? new Date(j.updated_at).toLocaleTimeString() : '—'}</td>
                    <td className="px-3 py-2 text-muted max-w-[280px] truncate" title={j.log || ''}>{(j.log || '').split('\n').slice(-1)[0] || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
