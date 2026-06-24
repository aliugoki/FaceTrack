import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, Avatar, Spinner, toast } from '../components/ui'
import EmployeeCard from '../components/EmployeeCard'
import EnrollModal from '../components/EnrollModal'
import BulkEnrollModal from '../components/BulkEnrollModal'
import { useAuth } from '../context/AuthContext'
import { fullName } from '../lib/socket'

export default function Employees() {
  const { can } = useAuth()
  const manage = can('manage_employees')
  const [list, setList] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [enroll, setEnroll] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = () => api('/api/employees').then(setList).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])
  const del = async (e: React.MouseEvent, emp_id: string) => {
    e.stopPropagation()
    if (!confirm(`Remove employee ${emp_id} (deletes their face data)?`)) return
    try { await api(`/api/employees/${encodeURIComponent(emp_id)}`, { method: 'DELETE' }); toast('Employee removed', 'ok'); load() }
    catch (err: any) { toast(err.message || 'Delete failed', 'err') }
  }

  const f = list.filter((e) => !q || `${fullName(e)} ${e.emp_id}`.toLowerCase().includes(q.toLowerCase()))
  const present = list.filter((e) => e.present).length

  return (
    <>
      <Card title="Employee directory" right={
        <div className="flex gap-2 items-center">
          <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="text-xs text-muted">{present} present / {list.length}</span>
          {manage && <button className="btn" onClick={() => setBulk(true)}>⭱ Bulk import</button>}
          {manage && <button className="btn bg-brand text-white border-brand" onClick={() => setEnroll(true)}>+ Enroll</button>}
        </div>}>
        {loading ? <Spinner /> : (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
            {f.map((e) => (
              <div key={e.emp_id} onClick={() => setSel(String(e.emp_id))}
                className="bg-surface2 border border-line rounded-xl p-3.5 text-center relative hover:border-brand transition cursor-pointer">
                <span className={`absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full ${e.present ? 'bg-ok' : 'bg-line'}`} title={e.present ? 'Present today' : 'Absent'} />
                {manage && <button className="absolute top-1.5 left-2 text-muted hover:text-bad text-sm" title="Remove" onClick={(ev) => del(ev, e.emp_id)}>✕</button>}
                <div className="flex justify-center mb-2"><Avatar src={e.photo} name={fullName(e)} size={64} /></div>
                <div className="font-semibold text-sm">{fullName(e)}</div>
                <div className="text-[11px] text-muted">ID {e.emp_id}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
      {sel && <EmployeeCard empId={sel} onClose={() => setSel(null)} />}
      {enroll && <EnrollModal onClose={() => setEnroll(false)} onDone={load} />}
      {bulk && <BulkEnrollModal onClose={() => setBulk(false)} onDone={load} />}
    </>
  )
}
