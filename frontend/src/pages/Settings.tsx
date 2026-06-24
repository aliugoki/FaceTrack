import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, Spinner, toast } from '../components/ui'

const DAYS: [string, string][] = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['7', 'Sun']]

export default function Settings() {
  const [data, setData] = useState<any>(null)
  const [pol, setPol] = useState<any>(null)
  const [h, setH] = useState({ day: '', name: '' })

  const load = () => api('/api/settings').then((r: any) => { setData(r); setPol(r.policy) }).catch(() => {})
  useEffect(() => { load() }, [])

  const save = async () => {
    try { await api('/api/settings', { method: 'PUT', body: pol }); toast('Policy saved', 'ok'); load() }
    catch { toast('Save failed', 'err') }
  }
  const toggleDay = (n: string) => {
    const s = new Set((pol.workdays || '').split(',').filter(Boolean))
    s.has(n) ? s.delete(n) : s.add(n)
    setPol({ ...pol, workdays: [...s].sort().join(',') })
  }
  const addHoliday = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await api('/api/settings/holidays', { method: 'POST', body: h }); setH({ day: '', name: '' }); load() }
    catch { toast('Add failed', 'err') }
  }
  const delHoliday = async (id: number) => { await api(`/api/settings/holidays/${id}`, { method: 'DELETE' }); load() }

  if (!data || !pol) return <Spinner />
  const workdays = new Set((pol.workdays || '').split(',').filter(Boolean))

  return (
    <div className="flex flex-col gap-4">
      <Card title="Attendance policy" right={<button className="btn bg-brand text-white border-brand" onClick={save}>Save</button>}>
        <div className="grid md:grid-cols-3 gap-4">
          <label className="text-sm">Shift start
            <input className="input w-full mt-1" type="time" value={pol.start_time}
              onChange={(e) => setPol({ ...pol, start_time: e.target.value })} /></label>
          <label className="text-sm">Grace (minutes)
            <input className="input w-full mt-1" type="number" min={0} value={pol.grace_minutes}
              onChange={(e) => setPol({ ...pol, grace_minutes: Number(e.target.value) })} /></label>
          <label className="text-sm">Timezone
            <input className="input w-full mt-1" value={pol.timezone}
              onChange={(e) => setPol({ ...pol, timezone: e.target.value })} /></label>
        </div>
        <div className="mt-4">
          <div className="text-sm mb-2">Working days</div>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map(([n, label]) => (
              <button key={n} onClick={() => toggleDay(n)}
                className={`btn ${workdays.has(n) ? 'bg-brand text-white border-brand' : ''}`}>{label}</button>
            ))}
          </div>
          <p className="text-xs text-muted mt-2">Arrivals after start + grace are marked <b>Late</b>. Working days drive attendance %.</p>
        </div>
      </Card>

      <Card title="Holidays" right={<span className="text-xs text-muted">{data.holidays.length} configured</span>}>
        <form onSubmit={addHoliday} className="flex gap-2 flex-wrap mb-4">
          <input className="input" type="date" value={h.day} onChange={(e) => setH({ ...h, day: e.target.value })} required />
          <input className="input" placeholder="name (e.g. Eid)" value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} />
          <button className="btn">+ Add holiday</button>
        </form>
        <div className="flex flex-col gap-2">
          {data.holidays.map((x: any) => (
            <div key={x.id} className="flex justify-between items-center bg-surface2 border border-line rounded-lg px-3.5 py-2.5">
              <span><b>{x.day}</b> <span className="text-muted">— {x.name || 'holiday'}</span></span>
              <button className="btn text-bad" onClick={() => delHoliday(x.id)}>Remove</button>
            </div>
          ))}
          {!data.holidays.length && <p className="text-muted text-sm">No holidays configured.</p>}
        </div>
      </Card>
    </div>
  )
}
