import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, Spinner, RoleChip } from '../components/ui'
import { fmtDate, fmtTime } from '../lib/socket'

export default function Audit() {
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => { api('/api/audit').then(setRows).catch(() => setRows([])) }, [])
  if (!rows) return <Spinner />

  const color = (a: string) =>
    /delete|clear/.test(a) ? 'text-bad' : a.includes('login') ? 'text-ok' : 'text-brand'

  return (
    <Card title="Audit log" right={<span className="text-xs text-muted">{rows.length} events</span>}>
      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface2 text-muted">
            <tr>{['When', 'Actor', 'Role', 'Action', 'Detail'].map((h) => <th key={h} className="text-left px-3.5 py-2.5 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/50 hover:bg-surface2">
                <td className="px-3.5 py-2.5 text-muted whitespace-nowrap">{fmtDate(r.created_at)} {fmtTime(r.created_at)}</td>
                <td className="px-3.5 py-2.5">{r.actor || '—'}</td>
                <td className="px-3.5 py-2.5">{r.role ? <RoleChip role={r.role} /> : '—'}</td>
                <td className={`px-3.5 py-2.5 font-semibold ${color(r.action)}`}>{r.action}</td>
                <td className="px-3.5 py-2.5 text-muted">{r.detail || '—'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="px-3.5 py-4 text-muted">No audit events yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
