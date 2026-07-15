import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, toast } from '../components/ui'

const BLANK = { company_name: '', admin_username: '', password: '', image_folder: '', webrtc_url: '', attendance_api: '' }

export default function Companies() {
  const [list, setList] = useState<any[]>([])
  const [form, setForm] = useState<any>(BLANK)
  const [edit, setEdit] = useState<any | null>(null)
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null)

  const load = () => api('/api/companies').then(setList).catch(() => {})
  useEffect(() => { load() }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const r: any = await api('/api/companies', { method: 'POST', body: form })
      setSecret({ label: `API key for ${form.company_name}`, value: r.api_key })
      toast('Company created', 'ok'); setForm(BLANK); load()
    } catch (err: any) { toast(err.message || 'Create failed', 'err') }
  }
  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api(`/api/companies/${edit.company_id}`, {
        method: 'PUT',
        body: {
          company_name: edit.company_name, image_folder: edit.image_folder,
          webrtc_url: edit.webrtc_url, attendance_api: edit.attendance_api,
        },
      })
      toast('Company updated', 'ok'); setEdit(null); load()
    } catch (err: any) { toast(err.message || 'Update failed', 'err') }
  }
  const setStatus = async (c: any, status: string) => { await api(`/api/companies/${c.company_id}`, { method: 'PUT', body: { status } }); load() }
  const rotate = async (c: any) => {
    if (!confirm(`Rotate API key for ${c.company_name}? The pipeline must be updated with the new key.`)) return
    const r: any = await api(`/api/companies/${c.company_id}/rotate-key`, { method: 'POST' })
    setSecret({ label: `New API key for ${c.company_name}`, value: r.api_key }); load()
  }
  const setPassword = async (c: any) => {
    const p = prompt(`New admin password for ${c.company_name} (min 6):`)
    if (!p) return
    try { await api(`/api/companies/${c.company_id}/password`, { method: 'POST', body: { password: p } }); toast('Password updated', 'ok') }
    catch (err: any) { toast(err.message || 'Failed', 'err') }
  }
  const del = async (c: any) => {
    const typed = prompt(
      `This permanently deletes "${c.company_name}" and ALL its data — cameras, employees, ` +
      `attendance, policy/holidays — and stops its pipeline. This cannot be undone.\n\n` +
      `Type the company name to confirm:`)
    if (typed == null) return
    if (typed.trim() !== c.company_name) { toast('Name did not match — nothing deleted', 'err'); return }
    try { await api(`/api/companies/${c.company_id}`, { method: 'DELETE' }); toast('Company deleted', 'ok'); load() }
    catch (err: any) { toast(err.message || 'Delete failed', 'err') }
  }

  return (
    <div className="flex flex-col gap-4">
      {secret && (
        <div className="card p-4 border-l-4 border-l-warn">
          <div className="text-sm font-semibold mb-1">{secret.label} — copy now, shown once</div>
          <code className="text-xs break-all bg-surface2 px-2 py-1 rounded">{secret.value}</code>
          <button className="btn ml-3" onClick={() => { navigator.clipboard?.writeText(secret.value); toast('Copied', 'ok') }}>Copy</button>
          <button className="btn ml-2" onClick={() => setSecret(null)}>Dismiss</button>
        </div>
      )}

      {edit && (
        <Card title={`Edit — ${edit.admin_username}`} right={<button className="btn" onClick={() => setEdit(null)}>Cancel</button>}>
          <form onSubmit={saveEdit} className="grid md:grid-cols-2 gap-3">
            <label className="text-sm">Company name
              <input className="input w-full mt-1" value={edit.company_name || ''} onChange={(e) => setEdit({ ...edit, company_name: e.target.value })} required /></label>
            <label className="text-sm">Image folder (gallery dir)
              <input className="input w-full mt-1" value={edit.image_folder || ''} onChange={(e) => setEdit({ ...edit, image_folder: e.target.value })} /></label>
            <label className="text-sm">WebRTC base URL
              <input className="input w-full mt-1" value={edit.webrtc_url || ''} onChange={(e) => setEdit({ ...edit, webrtc_url: e.target.value })} /></label>
            <label className="text-sm">ERP attendance API
              <input className="input w-full mt-1" value={edit.attendance_api || ''} onChange={(e) => setEdit({ ...edit, attendance_api: e.target.value })} /></label>
            <div className="md:col-span-2"><button className="btn bg-brand text-white border-brand">Save changes</button></div>
          </form>
        </Card>
      )}

      <Card title="Create company (tenant)">
        <form onSubmit={create} className="grid md:grid-cols-3 gap-3">
          <input className="input" placeholder="Company name" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required />
          <input className="input" placeholder="Admin username" value={form.admin_username} onChange={(e) => setForm({ ...form, admin_username: e.target.value })} required />
          <input className="input" type="password" placeholder="Admin password (min 6)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <input className="input" placeholder="Image folder (gallery dir name)" value={form.image_folder} onChange={(e) => setForm({ ...form, image_folder: e.target.value })} />
          <input className="input" placeholder="WebRTC base URL (optional)" value={form.webrtc_url} onChange={(e) => setForm({ ...form, webrtc_url: e.target.value })} />
          <input className="input" placeholder="ERP attendance API (optional)" value={form.attendance_api} onChange={(e) => setForm({ ...form, attendance_api: e.target.value })} />
          <div className="md:col-span-3"><button className="btn bg-brand text-white border-brand">+ Create company</button></div>
        </form>
      </Card>

      <Card title="Companies" right={<span className="text-xs text-muted">{list.length} tenants</span>}>
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-muted"><tr>{['Company', 'Admin', 'Status', 'API key', 'Actions'].map((h) => <th key={h} className="text-left px-3.5 py-2.5 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.company_id} className="border-b border-line/50">
                <td className="px-3.5 py-2.5 font-medium">{c.company_name}</td>
                <td className="px-3.5 py-2.5">{c.admin_username}</td>
                <td className="px-3.5 py-2.5"><span className={`text-xs px-2 py-1 rounded-full ${c.status === 'active' ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad'}`}>{c.status || 'active'}</span></td>
                <td className="px-3.5 py-2.5 text-muted">{c.has_api_key ? '••••••' : '—'}</td>
                <td className="px-3.5 py-2.5">
                  <div className="flex gap-2 flex-wrap">
                    <button className="btn" onClick={() => setEdit(c)}>Edit</button>
                    {c.status === 'active'
                      ? <button className="btn text-bad" onClick={() => setStatus(c, 'suspended')}>Suspend</button>
                      : <button className="btn text-ok" onClick={() => setStatus(c, 'active')}>Activate</button>}
                    <button className="btn" onClick={() => rotate(c)}>Rotate key</button>
                    <button className="btn" onClick={() => setPassword(c)}>Set password</button>
                    <button className="btn text-bad border-bad/40" onClick={() => del(c)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
