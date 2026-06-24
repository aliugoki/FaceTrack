import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, Avatar, Spinner } from '../components/ui'
import EmployeeCard from '../components/EmployeeCard'
import { fullName } from '../lib/socket'

export default function Employees() {
  const [list, setList] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { api('/api/employees').then(setList).catch(() => {}).finally(() => setLoading(false)) }, [])

  const f = list.filter((e) => !q || `${fullName(e)} ${e.emp_id}`.toLowerCase().includes(q.toLowerCase()))
  const present = list.filter((e) => e.present).length

  return (
    <>
      <Card title="Employee directory" right={
        <div className="flex gap-2 items-center">
          <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="text-xs text-muted">{present} present / {list.length}</span>
        </div>}>
        {loading ? <Spinner /> : (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
            {f.map((e) => (
              <button key={e.emp_id} onClick={() => setSel(String(e.emp_id))}
                className="bg-surface2 border border-line rounded-xl p-3.5 text-center relative hover:border-brand transition">
                <span className={`absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full ${e.present ? 'bg-ok' : 'bg-line'}`} title={e.present ? 'Present today' : 'Absent'} />
                <div className="flex justify-center mb-2"><Avatar src={e.photo} name={fullName(e)} size={64} /></div>
                <div className="font-semibold text-sm">{fullName(e)}</div>
                <div className="text-[11px] text-muted">ID {e.emp_id}</div>
              </button>
            ))}
          </div>
        )}
      </Card>
      {sel && <EmployeeCard empId={sel} onClose={() => setSel(null)} />}
    </>
  )
}
