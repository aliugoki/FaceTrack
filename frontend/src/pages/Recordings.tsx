import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Card, Spinner, toast } from '../components/ui'
import { fmtDate, fmtTime } from '../lib/socket'

// Best-guess recording start for the reprocess prefill. MediaMTX names segments
// by their START time (YYYY-MM-DD_HH-MM-SS) — more accurate for stamping
// attendance than the file mtime (which is when the segment finished writing).
const recStart = (rec: any): string => {
  const m = String(rec?.file || '').match(/(\d{4})-(\d{2})-(\d{2})[_T](\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`
  return rec?.modified ? String(rec.modified).slice(0, 16) : ''
}

// Reprocess an already-recorded file through inference (super-admin only). The
// recording is staged server-side (no re-upload) and queued exactly like a
// backfill upload; attendance is stamped from the recording's real start time.
function ReprocessPanel({ rec }: { rec: any }) {
  const [companies, setCompanies] = useState<any[]>([])
  const [company, setCompany] = useState('')
  const [start, setStart] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('/api/companies').then((cs: any) => {
      setCompanies(cs); if (cs.length) setCompany(cs[0].admin_username)
    }).catch(() => {})
  }, [])
  // Prefill the start time from the recording whenever the selection changes.
  useEffect(() => { setStart(recStart(rec)) }, [rec.path, rec.modified])

  const run = async () => {
    if (!company || !start) { toast('Pick a company and the recording start time', 'err'); return }
    setBusy(true)
    try {
      await api('/api/pipeline/backfill/recording', {
        method: 'POST', body: { path: rec.path, company, clip_start: start },
      })
      toast('Queued — this recording will be reprocessed through inference', 'ok')
    } catch (e: any) { toast(e.message || 'Failed', 'err') }
    finally { setBusy(false) }
  }

  return (
    <div className="mt-3 bg-surface2 border border-line rounded-lg p-3">
      <div className="text-xs text-muted font-semibold uppercase tracking-wide mb-2">Run inference on this recording</div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[11px] text-muted block mb-1">Company</label>
          <select className="input" value={company} onChange={(e) => setCompany(e.target.value)}>
            {!companies.length && <option value="">No companies</option>}
            {companies.map((c) => <option key={c.admin_username} value={c.admin_username}>{c.company_name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">Recording started at</label>
          <input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <button className="btn bg-brand/20 text-brand border-brand" disabled={busy || !company} onClick={run}>
          {busy ? 'Queuing…' : '⟳ Run inference'}
        </button>
      </div>
      <p className="text-[11px] text-muted mt-2">Reprocesses this file <b>faster than real-time</b> (no re-upload), stamping attendance at the true recording time. Progress shows under <b>Launch jobs</b> on the Pipeline page (action <code>backfill</code>).</p>
    </div>
  )
}

export default function Recordings() {
  const { can } = useAuth()
  const [list, setList] = useState<any[] | null>(null)
  const [sel, setSel] = useState<any>(null)
  useEffect(() => { api('/api/recordings').then(setList).catch(() => setList([])) }, [])
  if (!list) return <Spinner />

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <Card title="Recordings" className="lg:col-span-1" right={<span className="text-xs text-muted">{list.length}</span>}>
        <div className="flex flex-col gap-1 max-h-[70vh] overflow-auto">
          {list.map((r) => (
            <button key={r.path} onClick={() => setSel(r)}
              className={`text-left px-3 py-2 rounded-lg ${sel?.path === r.path ? 'bg-brand/15' : 'hover:bg-surface2'}`}>
              <div className="text-sm font-medium truncate">{r.camera}</div>
              <div className="text-xs text-muted">{fmtDate(r.modified)} {fmtTime(r.modified)} · {r.size_mb} MB</div>
            </button>
          ))}
          {!list.length && <p className="text-muted text-sm">No recordings found. Ensure MediaMTX is recording to the mounted directory.</p>}
        </div>
      </Card>
      <Card title={sel ? sel.file : 'Player'} className="lg:col-span-2">
        {sel
          ? <>
              <video key={sel.path} src={sel.url} className="w-full rounded-lg bg-black" controls autoPlay />
              {can('manage_tenants') && <ReprocessPanel rec={sel} />}
            </>
          : <p className="text-muted text-sm">Select a recording to play.</p>}
      </Card>
    </div>
  )
}
