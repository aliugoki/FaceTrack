import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Avatar, Spinner } from './ui'
import { fmtTime } from '../lib/socket'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function EmployeeCard({ empId, onClose }: { empId: string; onClose: () => void }) {
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 })
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    setData(null)
    api(`/api/employees/${encodeURIComponent(empId)}?month=${ym.y}-${String(ym.m).padStart(2, '0')}`).then(setData).catch(() => {})
  }, [empId, ym])

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])

  const shift = (d: number) => setYm((p) => {
    let m = p.m + d, y = p.y
    if (m < 1) { m = 12; y-- } if (m > 12) { m = 1; y++ }
    return { y, m }
  })

  const cellCls = (st?: string) => st === 'on_time' ? 'bg-ok/20 border-ok'
    : st === 'late' ? 'bg-warn/20 border-warn' : st === 'present' ? 'bg-brand/20 border-brand' : 'bg-surface2 border-line'

  const firstDow = new Date(ym.y, ym.m - 1, 1).getDay()
  const ndays = new Date(ym.y, ym.m, 0).getDate()
  const todayStr = new Date().toISOString().slice(0, 10)
  const s = data?.summary

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm grid place-items-center z-[60] p-5" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card p-6 w-[min(560px,96vw)] max-h-[92vh] overflow-auto animate-in relative">
        <button onClick={onClose} className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full bg-surface2 border border-line text-muted hover:text-bad">✕</button>
        {!data ? <Spinner /> : (
          <>
            <div className="flex gap-4 items-center mb-5">
              <Avatar src={data.photo} name={data.name} size={64} />
              <div><h2 className="text-xl font-bold">{data.name}</h2><div className="text-xs text-muted">ID {data.emp_id}</div></div>
            </div>
            <div className="grid grid-cols-4 gap-2.5 mb-5">
              {[['Present', s.present], ['On time', s.on_time], ['Late', s.late], ['Attendance', s.attendance_pct + '%']].map(([l, v]) => (
                <div key={l} className="bg-surface2 border border-line rounded-xl p-3 text-center">
                  <b className="text-2xl block tabular-nums">{v}</b><span className="text-[11px] text-muted">{l}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mb-2.5">
              <button className="btn" onClick={() => shift(-1)}>‹</button>
              <span className="font-bold min-w-[130px] text-center">{new Date(ym.y, ym.m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
              <button className="btn" onClick={() => shift(1)}>›</button>
              <div className="ml-auto flex gap-3 text-[11px] text-muted items-center">
                <span><i className="inline-block w-2.5 h-2.5 rounded bg-ok mr-1 align-middle" />On time</span>
                <span><i className="inline-block w-2.5 h-2.5 rounded bg-warn mr-1 align-middle" />Late</span>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {DOW.map((d) => <div key={d} className="text-center text-[11px] text-muted font-semibold py-1">{d}</div>)}
              {Array.from({ length: firstDow }).map((_, i) => <div key={'e' + i} />)}
              {Array.from({ length: ndays }).map((_, i) => {
                const day = i + 1
                const ds = `${ym.y}-${String(ym.m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const info = data.days[ds]
                return (
                  <div key={ds} title={info ? `${info.status} ${info.in_time || ''}` : 'no record'}
                    className={`aspect-square rounded-lg border flex flex-col items-center justify-center text-[13px] ${cellCls(info?.status)} ${ds === todayStr ? 'ring-2 ring-brand' : ''}`}>
                    {day}{info?.in_time && <span className="text-[9px] text-muted">{info.in_time}</span>}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
