import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, toast } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { hlsUrl, webrtcUrl, hasStream } from '../lib/streams'
import DetectionAreaModal from '../components/DetectionAreaModal'

const BLANK = { name: '', location: '', type: 'entrance', rtsp_url: '', hls_url: '', webrtc_url: '', enabled: true }

export default function Cameras() {
  const { can } = useAuth()
  const manage = can('manage_cameras')
  const [list, setList] = useState<any[]>([])
  const [form, setForm] = useState<any>(BLANK)
  const [editId, setEditId] = useState<number | null>(null)
  const [showAdv, setShowAdv] = useState(false)
  const [areaCam, setAreaCam] = useState<any | null>(null)   // camera whose zone is being drawn

  const load = () => api('/api/cameras').then(setList).catch(() => {})
  useEffect(() => { load() }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editId) await api(`/api/cameras/${editId}`, { method: 'PUT', body: form })
      else await api('/api/cameras', { method: 'POST', body: form })
      toast('Camera saved', 'ok'); setForm(BLANK); setEditId(null); setShowAdv(false); load()
    } catch (err: any) { toast(err.message || 'Save failed', 'err') }
  }
  const edit = (c: any) => { setForm({ ...c }); setEditId(c.id); setShowAdv(!!(c.hls_url || c.webrtc_url)) }
  const del = async (id: number) => { if (!confirm('Delete this camera?')) return; await api(`/api/cameras/${id}`, { method: 'DELETE' }); load() }

  // Derived live-stream URLs for the camera currently being edited.
  const autoHls = editId ? hlsUrl({ ...form, hls_url: '' }) : null
  const autoWebrtc = editId ? webrtcUrl({ ...form, webrtc_url: '' }) : null

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

            {/* HLS/WebRTC playback URLs are generated automatically from the
                camera's stream path — no manual entry needed. */}
            <div className="md:col-span-3 text-xs text-muted rounded-lg bg-surface2 px-3 py-2">
              {editId && form.stream_path ? (
                <>
                  <div className="mb-1">Live stream <b className="text-fg">auto-generated</b> (path <code>{form.stream_path}</code>):</div>
                  <div className="break-all">HLS&nbsp;&nbsp;&nbsp;<code>{form.hls_url || autoHls || '—'}</code></div>
                  <div className="break-all">WebRTC&nbsp;<code>{form.webrtc_url || autoWebrtc || '—'}</code></div>
                </>
              ) : (
                <>HLS &amp; WebRTC playback URLs are generated automatically once the camera is enabled with an RTSP source.</>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
            <button type="button" className="text-xs text-brand text-left md:col-span-2" onClick={() => setShowAdv(!showAdv)}>
              {showAdv ? '▾ Hide manual override' : '▸ Manual playback URL override (advanced)'}
            </button>
            {showAdv && <>
              <input className="input md:col-span-3" placeholder="HLS URL override (leave blank for auto)" value={form.hls_url || ''} onChange={(e) => setForm({ ...form, hls_url: e.target.value })} />
              <input className="input md:col-span-3" placeholder="WebRTC URL override (leave blank for auto)" value={form.webrtc_url || ''} onChange={(e) => setForm({ ...form, webrtc_url: e.target.value })} />
              <div className="md:col-span-3 text-xs uppercase tracking-wide text-muted mt-1">NVR (Hikvision) — for gap backfill</div>
              <input className="input" placeholder="NVR host/IP" value={form.nvr_host || ''} onChange={(e) => setForm({ ...form, nvr_host: e.target.value })} />
              <input className="input" type="number" placeholder="Port (80)" value={form.nvr_port ?? ''} onChange={(e) => setForm({ ...form, nvr_port: e.target.value === '' ? null : Number(e.target.value) })} />
              <input className="input" type="number" placeholder="Channel #" value={form.nvr_channel ?? ''} onChange={(e) => setForm({ ...form, nvr_channel: e.target.value === '' ? null : Number(e.target.value) })} />
              <input className="input" placeholder="NVR username" value={form.nvr_user || ''} onChange={(e) => setForm({ ...form, nvr_user: e.target.value })} />
              <input className="input" type="password" placeholder="NVR password" value={form.nvr_password || ''} onChange={(e) => setForm({ ...form, nvr_password: e.target.value })} />
            </>}

            <div className="md:col-span-3 flex gap-2">
              <button className="btn bg-brand text-white border-brand">{editId ? 'Update' : 'Add camera'}</button>
              {editId && <button type="button" className="btn" onClick={() => { setForm(BLANK); setEditId(null); setShowAdv(false) }}>Cancel</button>}
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
                <td className="px-3.5 py-2.5 text-muted">{(c.hls_url || c.webrtc_url) ? 'Manual' : hasStream(c) ? 'Auto (HLS+WebRTC)' : c.rtsp_url ? 'RTSP only' : '—'}</td>
                <td className="px-3.5 py-2.5"><span className={`w-2.5 h-2.5 rounded-full inline-block ${c.enabled ? 'bg-ok' : 'bg-line'}`} /></td>
                <td className="px-3.5 py-2.5">{manage && <span className="flex gap-2"><button className="btn" onClick={() => edit(c)}>Edit</button><button className="btn" title="Draw detection zone" onClick={() => setAreaCam(c)}>Zone{Array.isArray(c.detection_area) && c.detection_area.length >= 3 ? ' ●' : ''}</button><button className="btn text-bad" onClick={() => del(c.id)}>Delete</button></span>}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="px-3.5 py-4 text-muted">No cameras yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      {areaCam && <DetectionAreaModal cam={areaCam} onClose={() => setAreaCam(null)} onSaved={() => load()} />}
    </div>
  )
}
