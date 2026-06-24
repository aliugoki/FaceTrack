import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, toast } from '../components/ui'
import { useAuth } from '../context/AuthContext'

const BLANK = { name: '', location: '', type: 'entrance', rtsp_url: '', hls_url: '', webrtc_url: '', enabled: true }

export default function Cameras() {
  const { can } = useAuth()
  const manage = can('manage_cameras')
  const [list, setList] = useState<any[]>([])
  const [form, setForm] = useState<any>(BLANK)
  const [editId, setEditId] = useState<number | null>(null)

  const load = () => api('/api/cameras').then(setList).catch(() => {})
  useEffect(() => { load() }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editId) await api(`/api/cameras/${editId}`, { method: 'PUT', body: form })
      else await api('/api/cameras', { method: 'POST', body: form })
      toast('Camera saved', 'ok'); setForm(BLANK); setEditId(null); load()
    } catch (err: any) { toast(err.message || 'Save failed', 'err') }
  }
  const edit = (c: any) => { setForm({ ...c }); setEditId(c.id) }
  const del = async (id: number) => { if (!confirm('Delete this camera?')) return; await api(`/api/cameras/${id}`, { method: 'DELETE' }); load() }

  return (
    <div className="flex flex-col gap-4">
      {manage && (
        <Card title={editId ? 'Edit camera' : 'Add camera'}>
          <form onSubmit={submit} className="grid md:grid-cols-3 gap-3">
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="input" placeholder="Location" value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="entrance">entrance</option><option value="exit">exit</option><option value="general">general</option>
            </select>
            <input className="input md:col-span-3" placeholder="RTSP source URL (for the pipeline)" value={form.rtsp_url || ''} onChange={(e) => setForm({ ...form, rtsp_url: e.target.value })} />
            <input className="input" placeholder="HLS URL (playback)" value={form.hls_url || ''} onChange={(e) => setForm({ ...form, hls_url: e.target.value })} />
            <input className="input" placeholder="WebRTC URL (playback)" value={form.webrtc_url || ''} onChange={(e) => setForm({ ...form, webrtc_url: e.target.value })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
            <div className="md:col-span-3 flex gap-2">
              <button className="btn bg-brand text-white border-brand">{editId ? 'Update' : 'Add camera'}</button>
              {editId && <button type="button" className="btn" onClick={() => { setForm(BLANK); setEditId(null) }}>Cancel</button>}
            </div>
          </form>
        </Card>
      )}
      <Card title="Cameras" right={<span className="text-xs text-muted">{list.length} configured</span>}>
        <table className="w-full text-sm">
          <thead className="bg-surface2 text-muted"><tr>{['Name', 'Location', 'Type', 'Playback', 'Status', ''].map((h) => <th key={h} className="text-left px-3.5 py-2.5 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className="border-b border-line/50">
                <td className="px-3.5 py-2.5 font-medium">{c.name}</td>
                <td className="px-3.5 py-2.5 text-muted">{c.location || '—'}</td>
                <td className="px-3.5 py-2.5">{c.type}</td>
                <td className="px-3.5 py-2.5 text-muted">{c.hls_url ? 'HLS' : c.webrtc_url ? 'WebRTC' : c.rtsp_url ? 'RTSP only' : '—'}</td>
                <td className="px-3.5 py-2.5"><span className={`w-2.5 h-2.5 rounded-full inline-block ${c.enabled ? 'bg-ok' : 'bg-line'}`} /></td>
                <td className="px-3.5 py-2.5">{manage && <span className="flex gap-2"><button className="btn" onClick={() => edit(c)}>Edit</button><button className="btn text-bad" onClick={() => del(c.id)}>Delete</button></span>}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="px-3.5 py-4 text-muted">No cameras yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
