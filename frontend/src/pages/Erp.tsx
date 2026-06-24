import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, Spinner, toast } from '../components/ui'

function Pill({ ok, children }: { ok: boolean; children: any }) {
  return <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full uppercase ${ok ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad'}`}>{children}</span>
}

export default function Erp() {
  const [d, setD] = useState<any>(null)
  const load = () => api('/api/erp').then(setD).catch(() => {})
  useEffect(() => { load() }, [])

  const resync = async () => {
    try { const r: any = await api('/api/erp/resync', { method: 'POST' }); toast(`Resynced ${r.resynced}/${r.attempted} to ERP`, 'ok'); load() }
    catch { toast('Resync failed', 'err') }
  }

  if (!d) return <Spinner />
  return (
    <Card title="ERP integration" right={<span className="text-xs text-muted">real-time attendance sync</span>}>
      <div className="flex flex-col gap-3.5">
        <div className="flex justify-between items-center bg-surface2 border border-line rounded-xl px-4 py-3">
          <div><b>Endpoint</b><div className="text-xs text-muted break-all">{d.url || 'not configured'}</div></div>
          <Pill ok={d.configured}>{d.configured ? 'Connected' : 'Not configured'}</Pill>
        </div>
        <div className="flex justify-between items-center bg-surface2 border border-line rounded-xl px-4 py-3">
          <div><b>Real-time push</b><div className="text-xs text-muted">each recognition is sent to your ERP automatically</div></div>
          <Pill ok={d.realtime}>{d.realtime ? 'On' : 'Off'}</Pill>
        </div>
        <div className="flex gap-3.5">
          <div className="flex-1 bg-surface2 border border-line rounded-xl py-3 text-center"><b className="text-2xl block">{d.sent_today}</b><span className="text-xs text-muted">synced today</span></div>
          <div className="flex-1 bg-surface2 border border-line rounded-xl py-3 text-center"><b className="text-2xl block">{d.pending_today}</b><span className="text-xs text-muted">pending today</span></div>
        </div>
        {d.can_manage && <button className="btn w-fit" onClick={resync}>↻ Resync pending</button>}
      </div>
    </Card>
  )
}
