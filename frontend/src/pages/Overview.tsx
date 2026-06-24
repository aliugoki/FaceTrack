import { useEffect, useState } from 'react'
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useLive } from '../lib/useLive'
import { api } from '../lib/api'
import { Card, Kpi, Avatar, Badge } from '../components/ui'
import { fullName, fmtTime } from '../lib/socket'

export default function Overview() {
  const { entries, stats, connected } = useLive()
  const [hourly, setHourly] = useState<any[]>([])

  useEffect(() => {
    const load = () => api('/api/attendance/hourly').then((d: any) =>
      setHourly(d.hours.map((h: number) => ({ h: String(h).padStart(2, '0'), In: d.in[h], Out: d.out[h] })))).catch(() => {})
    load(); const t = setInterval(load, 30000); return () => clearInterval(t)
  }, [entries.length])

  const s = stats || {}
  const rate = s.total_registered_employees ? Math.round((s.total_present_today / s.total_registered_employees) * 100) : 0
  const punct = [{ name: 'On Time', value: s.total_on_time_today || 0 }, { name: 'Late', value: s.total_late_today || 0 }]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Present Today" value={s.total_present_today ?? 0} foot={`${rate}% of workforce`} accent="brand" />
        <Kpi label="On Time" value={s.total_on_time_today ?? 0} foot="before 09:00" accent="ok" />
        <Kpi label="Late" value={s.total_late_today ?? 0} foot="after 09:00" accent="warn" />
        <Kpi label="Registered" value={s.total_registered_employees ?? 0} foot="enrolled faces" accent="violet" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Check-ins by hour" right={<span className="text-xs text-muted">today</span>}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hourly}>
              <XAxis dataKey="h" stroke="rgb(var(--muted))" fontSize={11} />
              <YAxis stroke="rgb(var(--muted))" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={{ background: 'rgb(var(--surface2))', border: '1px solid rgb(var(--line))', borderRadius: 10 }} />
              <Legend />
              <Bar dataKey="In" stackId="a" fill="rgb(var(--brand))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Out" stackId="a" fill="rgb(var(--violet))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Punctuality" right={<span className="text-xs text-muted">today</span>}>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={punct} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90}>
                <Cell fill="rgb(var(--ok))" /><Cell fill="rgb(var(--warn))" />
              </Pie>
              <Legend /><Tooltip contentStyle={{ background: 'rgb(var(--surface2))', border: '1px solid rgb(var(--line))', borderRadius: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Recent activity" right={<span className={`text-xs ${connected ? 'text-ok' : 'text-muted'}`}>● {connected ? 'live' : 'offline'}</span>}>
        <ul className="flex flex-col gap-2">
          {entries.slice(0, 8).map((e, i) => (
            <li key={e.id || i} className="flex items-center gap-3 bg-surface2 rounded-xl px-3 py-2.5 animate-in">
              <Avatar src={e.image_url} name={fullName(e)} size={38} />
              <div className="flex-1 min-w-0"><div className="font-semibold">{fullName(e)}</div>
                <div className="text-xs text-muted">ID {e.emp_id} · {e.camera_name || 'camera'}</div></div>
              <Badge kind={e.check_type === 'out' ? 'out' : (e.status || '').toLowerCase() === 'late' ? 'late' : 'ontime'}>
                {e.check_type === 'out' ? 'Out' : e.status === 'Late' ? 'Late' : 'In'}</Badge>
              <span className="text-muted text-sm tabular-nums">{fmtTime(e.attendance_time)}</span>
            </li>
          ))}
          {!entries.length && <li className="text-muted text-sm">No activity yet.</li>}
        </ul>
      </Card>
    </div>
  )
}
