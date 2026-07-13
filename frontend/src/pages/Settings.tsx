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

  const set = (k: string, v: any) => setPol({ ...pol, [k]: v })
  const setNum = (k: string, v: string) => set(k, v === '' ? null : Number(v))

  const save = async () => {
    try { await api('/api/settings', { method: 'PUT', body: pol }); toast('Policy saved', 'ok'); load() }
    catch (e: any) { toast(e.message || 'Save failed', 'err') }
  }
  const toggleDay = (n: string) => {
    const s = new Set((pol.workdays || '').split(',').filter(Boolean))
    s.has(n) ? s.delete(n) : s.add(n)
    set('workdays', [...s].sort().join(','))
  }
  const addHoliday = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await api('/api/settings/holidays', { method: 'POST', body: h }); setH({ day: '', name: '' }); load() }
    catch { toast('Add failed', 'err') }
  }
  const delHoliday = async (id: number) => { await api(`/api/settings/holidays/${id}`, { method: 'DELETE' }); load() }

  if (!data || !pol) return <Spinner />
  const workdays = new Set((pol.workdays || '').split(',').filter(Boolean))
  const section = (t: string) => <div className="text-xs uppercase tracking-wide text-muted mt-5 mb-2 first:mt-0">{t}</div>
  // Function helpers (not components) so inputs don't remount / lose focus on keystroke.
  const timeField = (label: string, k: string) => (
    <label className="text-sm">{label}
      <input className="input w-full mt-1" type="time" value={pol[k] ?? ''} onChange={(e) => set(k, e.target.value || null)} /></label>
  )
  const numField = (label: string, k: string, ph?: string) => (
    <label className="text-sm">{label}
      <input className="input w-full mt-1" type="number" min={0} value={pol[k] ?? ''} placeholder={ph} onChange={(e) => setNum(k, e.target.value)} /></label>
  )

  return (
    <div className="flex flex-col gap-4">
      <Card title="Attendance policy" right={<button className="btn bg-brand text-white border-brand" onClick={save}>Save</button>}>
        {section('Shift')}
        <div className="grid md:grid-cols-3 gap-4">
          {timeField('Shift start', 'start_time')}
          {timeField('Shift end', 'end_time')}
          <label className="text-sm">Timezone
            <input className="input w-full mt-1" value={pol.timezone ?? ''} onChange={(e) => set('timezone', e.target.value)} /></label>
        </div>

        {section('Break (optional, unpaid)')}
        <div className="grid md:grid-cols-3 gap-4">
          {timeField('Break start', 'break_start')}
          {timeField('Break end', 'break_end')}
        </div>
        <p className="text-xs text-muted mt-2">Break time is excluded from worked hours. Leave both empty for no break.</p>

        {section('Thresholds (minutes)')}
        <div className="grid md:grid-cols-3 gap-4">
          {numField('Late grace', 'grace_minutes')}
          {numField('Early-leave grace', 'early_leave_grace_minutes')}
          {numField('Half-day under', 'half_day_after_minutes')}
          {numField('Min worked (full day)', 'min_work_minutes')}
          {numField('Overtime after (0 = off)', 'overtime_after_minutes')}
        </div>
        <p className="text-xs text-muted mt-2">
          After <b>start + late grace</b> → <b>Late</b>; checkout before <b>end − early-leave grace</b> → <b>Left Early</b>;
          under <b>half-day</b> minutes → <b>Half Day</b>; beyond scheduled + <b>overtime</b> → <b>Overtime</b>.
        </p>

        {section('Working days')}
        <div className="flex gap-2 flex-wrap">
          {DAYS.map(([n, label]) => (
            <button key={n} onClick={() => toggleDay(n)}
              className={`btn ${workdays.has(n) ? 'bg-brand text-white border-brand' : ''}`}>{label}</button>
          ))}
        </div>
        <p className="text-xs text-muted mt-2">Working days drive attendance %.</p>
      </Card>

      <Card title="Recordings" right={<button className="btn bg-brand text-white border-brand" onClick={save}>Save</button>}>
        <label className="text-sm">Retention (days)
          <input className="input w-full md:w-64 mt-1" type="number" min={0} value={pol.recordings_retention_days ?? ''}
            placeholder="default (2 days)" onChange={(e) => setNum('recordings_retention_days', e.target.value)} /></label>
        <p className="text-xs text-muted mt-2">
          How long video recordings are kept before automatic deletion. <b>0</b> = keep forever; empty = system default (48h).
          Enforced natively by MediaMTX and applies within seconds of saving — no stream interruption.
        </p>
      </Card>

      <Card title="Face recognition" right={<button className="btn bg-brand text-white border-brand" onClick={save}>Save</button>}>
        <p className="text-xs text-muted mb-4">
          Tune matching to your cameras &amp; gallery. <b>Higher</b> threshold / margin → fewer <b>wrong matches</b> (mismatch);
          <b> lower</b> threshold → fewer <b>missed</b> recognitions (unmatched). Saving restarts this company's pipeline to apply.
        </p>
        <div className="grid md:grid-cols-3 gap-4 items-end">
          <label className="text-sm">Match threshold — <b className="tabular-nums">{Number(pol.rec_threshold ?? 0.35).toFixed(2)}</b>
            <input className="w-full mt-2 accent-brand" type="range" min={0.1} max={0.7} step={0.01}
              value={pol.rec_threshold ?? 0.35} onChange={(e) => set('rec_threshold', Number(e.target.value))} />
            <div className="flex justify-between text-[10px] text-muted"><span>lenient</span><span>strict</span></div>
          </label>
          <label className="text-sm">Margin (best vs 2nd-best)
            <input className="input w-full mt-1" type="number" min={0} max={1} step={0.01}
              value={pol.rec_margin ?? 0.05} onChange={(e) => setNum('rec_margin', e.target.value)} /></label>
          <label className="text-sm">Stability votes
            <input className="input w-full mt-1" type="number" min={1} step={1}
              value={pol.rec_min_votes ?? 3} onChange={(e) => setNum('rec_min_votes', e.target.value)} /></label>
        </div>
        <p className="text-xs text-muted mt-2">
          Defaults 0.35 / 0.05 / 3. Raise <b>threshold</b> or <b>margin</b> if the wrong person is ever matched;
          lower the <b>threshold</b> (or votes) if known people are missed. Margin guards against similar-looking enrollments;
          votes require that many consecutive frames before confirming.
        </p>
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
