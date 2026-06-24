import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, Spinner } from '../components/ui'

export default function Tenants() {
  const [list, setList] = useState<any[] | null>(null)
  useEffect(() => { api('/api/tenants').then(setList).catch(() => setList([])) }, [])
  if (!list) return <Spinner />

  return (
    <Card title="Tenant overview" right={<span className="text-xs text-muted">{list.length} tenants</span>}>
      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))' }}>
        {list.map((t) => (
          <div key={t.company_id} className={`bg-surface2 border rounded-xl p-4 ${t.present_today === 0 ? 'border-warn' : 'border-line'}`}>
            <div className="font-bold">{t.company_name}</div>
            <div className="text-[11px] text-muted uppercase tracking-wide">{t.status || 'active'}</div>
            <div className="flex gap-3.5 mt-3">
              {[['present', t.present_today], ['on time', t.on_time_today], ['late', t.late_today], ['enrolled', t.registered]].map(([l, v]) => (
                <div key={l as string} className="flex-1"><b className="text-xl block tabular-nums">{v as any}</b><span className="text-[11px] text-muted">{l}</span></div>
              ))}
            </div>
          </div>
        ))}
        {!list.length && <p className="text-muted text-sm">No tenants visible.</p>}
      </div>
    </Card>
  )
}
