import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, Kpi, Spinner, toast } from '../components/ui'

export default function Pipeline() {
  const [companies, setCompanies] = useState<any[]>([])
  const [company, setCompany] = useState('')   // target admin_username
  const [index, setIndex] = useState(0)
  const [d, setD] = useState<any>(null)
  const [jobs, setJobs] = useState<any[]>([])

  const loadJobs = () => api('/api/pipeline/jobs').then(setJobs).catch(() => {})
  const load = (comp = company, i = index) => {
    if (!comp) return
    setD(null)
    api(`/api/pipeline/provision?company=${encodeURIComponent(comp)}&index=${i}`).then(setD).catch(() => {})
  }

  useEffect(() => {
    api('/api/companies').then((cs: any) => {
      setCompanies(cs)
      if (cs.length) { setCompany(cs[0].admin_username); load(cs[0].admin_username, 0) }
    }).catch(() => {})
    loadJobs(); const t = setInterval(loadJobs, 4000); return () => clearInterval(t)
  }, [])

  const launch = async (action: string) => {
    try {
      await api('/api/pipeline/launch', { method: 'POST', body: { company, action, index } })
      toast(`Queued ${action} for ${company} (index ${index})`, 'ok'); loadJobs()
    } catch (e: any) { toast(e.message || 'Failed', 'err') }
  }
  const copy = (t: string) => { navigator.clipboard?.writeText(t); toast('Copied', 'ok') }
  const download = () => {
    const b = new Blob([d.config], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = d.config_filename; a.click()
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="Pipeline provisioning"
        right={<div className="flex gap-2 items-center flex-wrap">
          <select className="input" value={company} onChange={(e) => { setCompany(e.target.value); load(e.target.value, index) }}>
            {companies.map((c) => <option key={c.admin_username} value={c.admin_username}>{c.company_name}</option>)}
          </select>
          <label className="text-xs text-muted">Index</label>
          <input className="input w-20" type="number" min={0} value={index} onChange={(e) => setIndex(Number(e.target.value))} />
          <button className="btn" onClick={() => load()}>Apply</button>
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
                <button className="btn bg-ok/20 text-ok border-ok" onClick={() => launch('start')}>▶ Launch</button>
                <button className="btn text-bad" onClick={() => launch('stop')}>■ Stop</button>
              </div>
            </div>
            <p className="text-xs text-muted mt-2">Launch/stop is queued to the host agent (the dashboard never runs docker). Give each company a <b>distinct index</b> so ports don't collide. RTX 3070 ≈ 1–2 companies concurrently.</p>
          </>
        )}
      </Card>

      <Card title="Launch jobs" right={<span className="text-xs text-muted">via host agent · auto-refreshes</span>}>
        {!jobs.length ? <p className="text-muted text-sm">No launch jobs yet. Use ▶ Launch above (requires the host agent running).</p> : (
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

      {d && (
        <Card title="Generated config" right={<div className="flex gap-2">
          <button className="btn" onClick={() => copy(d.config)}>Copy</button>
          <button className="btn" onClick={download}>⭳ {d.config_filename}</button>
        </div>}>
          <pre className="bg-surface2 border border-line rounded-lg p-3 text-xs overflow-auto max-h-[44vh] whitespace-pre">{d.config}</pre>
        </Card>
      )}
    </div>
  )
}
