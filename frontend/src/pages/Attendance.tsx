import { useMemo, useState } from 'react'
import { useLive } from '../lib/useLive'
import { Card, Avatar, Badge } from '../components/ui'
import EmployeeCard from '../components/EmployeeCard'
import { fullName, fmtTime, fmtDate } from '../lib/socket'

export default function Attendance() {
  const { entries } = useLive()
  const [q, setQ] = useState(''); const [ty, setTy] = useState(''); const [st, setSt] = useState(''); const [date, setDate] = useState('')
  const [sel, setSel] = useState<string | null>(null)

  const rows = useMemo(() => entries.filter((e) => {
    if (q && !`${fullName(e)} ${e.emp_id}`.toLowerCase().includes(q.toLowerCase())) return false
    if (ty && (e.check_type || '').toLowerCase() !== ty) return false
    if (st && (e.status || '') !== st) return false
    if (date && !String(e.attendance_date || '').startsWith(date)) return false
    return true
  }), [entries, q, ty, st, date])

  const csv = () => {
    const head = ['Name', 'Emp ID', 'Type', 'Status', 'Time', 'Date']
    const body = rows.map((e) => [fullName(e), e.emp_id, e.check_type, e.status, e.attendance_time, e.attendance_date]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `attendance_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  }

  const toolbar = (
    <div className="flex gap-2 flex-wrap">
      <input className="input" placeholder="Search name or ID…" value={q} onChange={(e) => setQ(e.target.value)} />
      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <select className="input" value={ty} onChange={(e) => setTy(e.target.value)}><option value="">All</option><option value="in">In</option><option value="out">Out</option></select>
      <select className="input" value={st} onChange={(e) => setSt(e.target.value)}><option value="">Any status</option><option>On Time</option><option>Late</option><option>Exit</option></select>
      <button className="btn" onClick={csv}>⭳ CSV</button>
    </div>
  )

  return (
    <>
      <Card title="Attendance log" right={toolbar}>
        <div className="overflow-auto max-h-[64vh] rounded-lg">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface2 text-muted">
              <tr>{['Employee', 'ID', 'Type', 'Status', 'Time', 'Date'].map((h) => <th key={h} className="text-left px-3.5 py-3 font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.id || i} className="border-b border-line/50 hover:bg-surface2 cursor-pointer" onClick={() => setSel(String(e.emp_id))}>
                  <td className="px-3.5 py-2.5"><div className="flex items-center gap-2"><Avatar src={e.image_url} name={fullName(e)} size={30} /><span>{fullName(e)}</span></div></td>
                  <td className="px-3.5 py-2.5">{e.emp_id}</td>
                  <td className="px-3.5 py-2.5"><Badge kind={e.check_type === 'out' ? 'out' : (e.status || '').toLowerCase() === 'late' ? 'late' : 'ontime'}>{e.check_type === 'out' ? 'Out' : e.status === 'Late' ? 'Late' : 'In'}</Badge></td>
                  <td className="px-3.5 py-2.5 text-muted">{e.status || '—'}</td>
                  <td className="px-3.5 py-2.5 tabular-nums">{fmtTime(e.attendance_time)}</td>
                  <td className="px-3.5 py-2.5">{fmtDate(e.attendance_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-xs text-muted pt-2.5">{rows.length} record{rows.length === 1 ? '' : 's'}</div>
      </Card>
      {sel && <EmployeeCard empId={sel} onClose={() => setSel(null)} />}
    </>
  )
}
