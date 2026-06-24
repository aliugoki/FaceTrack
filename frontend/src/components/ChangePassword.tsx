import { useState } from 'react'
import { api } from '../lib/api'
import { toast } from './ui'

export default function ChangePassword({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState('')
  const [nw, setNw] = useState('')
  const [cf, setCf] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (nw.length < 6) return toast('New password must be at least 6 characters', 'err')
    if (nw !== cf) return toast('New passwords do not match', 'err')
    setBusy(true)
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { current_password: cur, new_password: nw } })
      toast('Password changed', 'ok'); onClose()
    } catch (err: any) {
      toast(err.message || 'Change failed', 'err')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm grid place-items-center z-[60] p-5"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="card p-6 w-[min(380px,94vw)] animate-in">
        <h2 className="text-lg font-bold mb-4">Change password</h2>
        <input className="input w-full mb-3" type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} required autoFocus />
        <input className="input w-full mb-3" type="password" placeholder="New password (min 6)" value={nw} onChange={(e) => setNw(e.target.value)} required />
        <input className="input w-full mb-5" type="password" placeholder="Confirm new password" value={cf} onChange={(e) => setCf(e.target.value)} required />
        <div className="flex gap-2">
          <button className="btn bg-brand text-white border-brand flex-1" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
