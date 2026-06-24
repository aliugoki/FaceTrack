import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, RoleChip, toast } from '../components/ui'
import { fmtDate } from '../lib/socket'

export default function Users() {
  const [list, setList] = useState<any[]>([])
  const [f, setF] = useState({ username: '', password: '', role: 'viewer' })

  const load = () => api('/api/users').then(setList).catch(() => {})
  useEffect(() => { load() }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await api('/api/users', { method: 'POST', body: f }); toast('User added', 'ok'); setF({ username: '', password: '', role: 'viewer' }); load() }
    catch (err: any) { toast(err.message || 'Create failed', 'err') }
  }
  const del = async (id: number) => {
    if (!confirm('Remove this user?')) return
    try { await api(`/api/users/${id}`, { method: 'DELETE' }); toast('User removed', 'ok'); load() }
    catch { toast('Remove failed', 'err') }
  }

  return (
    <Card title="User management" right={<span className="text-xs text-muted">roles: viewer · manager · admin</span>}>
      <form onSubmit={create} className="flex gap-2 flex-wrap mb-4">
        <input className="input" placeholder="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
        <input className="input" type="password" placeholder="password (min 6)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
        <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option value="viewer">Viewer</option><option value="manager">Manager</option><option value="admin">Admin</option>
        </select>
        <button className="btn">+ Add user</button>
      </form>
      <table className="w-full text-sm">
        <thead className="bg-surface2 text-muted"><tr>{['User', 'Role', 'Created', ''].map((h) => <th key={h} className="text-left px-3.5 py-2.5 font-semibold">{h}</th>)}</tr></thead>
        <tbody>
          {list.map((u) => (
            <tr key={u.id} className="border-b border-line/50">
              <td className="px-3.5 py-2.5">{u.username}</td>
              <td className="px-3.5 py-2.5"><RoleChip role={u.role} /></td>
              <td className="px-3.5 py-2.5 text-muted">{u.created_at ? fmtDate(u.created_at) : '—'}</td>
              <td className="px-3.5 py-2.5"><button className="btn text-bad" onClick={() => del(u.id)}>Remove</button></td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={4} className="px-3.5 py-4 text-muted">No additional users yet.</td></tr>}
        </tbody>
      </table>
    </Card>
  )
}
