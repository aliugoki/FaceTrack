import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await login(u, p); nav('/') }
    catch (e: any) { setErr(e.message || 'Login failed') }
    finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen grid place-items-center p-5">
      <form onSubmit={submit} className="card p-8 w-[min(380px,94vw)] animate-in">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl grid place-items-center text-2xl text-white"
            style={{ background: 'linear-gradient(135deg,rgb(var(--brand)),rgb(var(--violet)))' }}>◎</div>
          <div><div className="font-bold text-lg">FaceTrack</div><div className="text-xs text-muted">Attendance Command Center</div></div>
        </div>
        {err && <div className="bg-bad/15 text-bad text-sm rounded-lg px-3 py-2 mb-3">{err}</div>}
        <label className="text-xs text-muted">Username</label>
        <input className="input w-full mt-1 mb-3" value={u} onChange={(e) => setU(e.target.value)} autoFocus />
        <label className="text-xs text-muted">Password</label>
        <input className="input w-full mt-1 mb-5" type="password" value={p} onChange={(e) => setP(e.target.value)} />
        <button className="btn w-full bg-brand text-white border-brand font-semibold" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
