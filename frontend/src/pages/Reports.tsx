import { useEffect, useState } from 'react'
import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts'
import { api } from '../lib/api'
import { Card, Kpi, Spinner } from '../components/ui'
import EmployeeCard from '../components/EmployeeCard'
import { fmtDate } from '../lib/socket'

const range = (days: number) => {
  const to = new Date(), from = new Date(); from.setDate(to.getDate() - (days - 1))
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

export default function Reports() {
  const init = range(30)
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [data, setData] = useState<any>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)

  const load = (f = from, t = to) => { setData(null); api(`/api/reports?from=${f}&to=${t}`).then(setData).catch(() => {}) }
  useEffect(() => { load() }, [])
  const preset = (d: number) => { const r = range(d); setFrom(r.from); setTo(r.to); load(r.from, r.to) }

  const s = data?.summary
  const emp = (data?.by_employee || []).filter((e: any) => !q || `${e.name} ${e.emp_id}`.toLowerCase().includes(q.toLowerCase()))
  const csv = () => {
    const head = ['Employee', 'Emp ID', 'Days Present', 'On Time', 'Late', 'Attendance %', 'Last Seen']
    const body = (data.by_employee || []).map((e: any) => [e.name, e.emp_id, e.days_present, e.on_time, e.late, e.attendance_pct, e.last_seen]
      .map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `report_${from}_${to}.csv`; a.click()
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="Attendance report" right={
        <div className="flex gap-2 flex-wrap items-center">
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="flex rounded-lg overflow-hidden border border-line">
            {[7, 30, 90].map((d) => <button key={d} className="btn rounded-none border-0" onClick={() => preset(d)}>{d}d</button>)}
          </div>
          <button className="btn" onClick={() => load()}>Run</button>
          <button className="btn" onClick={csv} disabled={!data}>⭳ CSV</button>
        </div>}>
        {!data ? <Spinner /> : (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
            {[['Working days', s.working_days], ['Unique present', s.unique_present], ['On-time', s.on_time],
              ['Late', s.late], ['Check-outs', s.total_checkouts], ['Avg first-in', s.avg_first_in]].map(([l, v]) => (
              <Kpi key={l as string} label={l as string} value={v as any} />
            ))}
          </div>
        )}
      </Card>

      {data && (
        <>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Daily trend">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.by_day.map((d: any) => ({ ...d, date: d.date.slice(5) }))}>
                  <CartesianGrid stroke="rgb(var(--line))" vertical={false} />
                  <XAxis dataKey="date" stroke="rgb(var(--muted))" fontSize={11} />
                  <YAxis stroke="rgb(var(--muted))" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: 'rgb(var(--surface2))', border: '1px solid rgb(var(--line))', borderRadius: 10 }} />
                  <Legend />
                  <Line type="monotone" dataKey="present" stroke="rgb(var(--brand))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="late" stroke="rgb(var(--warn))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
            <Card title="On-time vs late">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={[{ name: 'On Time', value: s.on_time }, { name: 'Late', value: s.late }]} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88}>
                    <Cell fill="rgb(var(--ok))" /><Cell fill="rgb(var(--warn))" />
                  </Pie><Legend /><Tooltip contentStyle={{ background: 'rgb(var(--surface2))', border: '1px solid rgb(var(--line))', borderRadius: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card title="By employee" right={<input className="input" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />}>
            <div className="overflow-auto max-h-[50vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface2 text-muted">
                  <tr>{['Employee', 'ID', 'Days', 'On time', 'Late', 'Attendance %', 'Last seen'].map((h) => <th key={h} className="text-left px-3.5 py-2.5 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {emp.map((e: any) => (
                    <tr key={e.emp_id} className="border-b border-line/50 hover:bg-surface2 cursor-pointer" onClick={() => setSel(String(e.emp_id))}>
                      <td className="px-3.5 py-2.5">{e.name}</td><td className="px-3.5 py-2.5">{e.emp_id}</td>
                      <td className="px-3.5 py-2.5">{e.days_present}</td><td className="px-3.5 py-2.5">{e.on_time}</td><td className="px-3.5 py-2.5">{e.late}</td>
                      <td className="px-3.5 py-2.5">
                        <span className="inline-block w-16 h-1.5 rounded bg-line mr-2 align-middle overflow-hidden">
                          <span className="block h-full" style={{ width: `${Math.min(e.attendance_pct, 100)}%`, background: 'linear-gradient(90deg,rgb(var(--brand)),rgb(var(--ok)))' }} /></span>
                        {e.attendance_pct}%
                      </td>
                      <td className="px-3.5 py-2.5 text-muted">{e.last_seen ? fmtDate(e.last_seen) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      {sel && <EmployeeCard empId={sel} onClose={() => setSel(null)} />}
    </div>
  )
}
