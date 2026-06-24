import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { toast } from './ui'

export default function EnrollModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ emp_id: '', first_name: '', last_name: '' })
  const [img, setImg] = useState<string>('')   // data URL
  const [busy, setBusy] = useState(false)
  const [camOn, setCamOn] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stopCam = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setCamOn(false) }
  useEffect(() => () => stopCam(), [])

  const startCam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      streamRef.current = s; setCamOn(true)
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play() }
    } catch { toast('Camera unavailable — use Upload instead', 'err') }
  }
  const capture = () => {
    const v = videoRef.current; if (!v) return
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    setImg(c.toDataURL('image/jpeg', 0.9)); stopCam()
  }
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const r = new FileReader(); r.onload = () => setImg(r.result as string); r.readAsDataURL(file)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.emp_id.trim()) return toast('Employee ID required', 'err')
    if (!img) return toast('Capture or upload a photo', 'err')
    setBusy(true)
    try {
      const r: any = await api('/api/employees/enroll', { method: 'POST', body: { ...f, image_b64: img } })
      toast(`Enrolled ${f.emp_id} (face conf ${r.confidence})`, 'ok'); onDone(); onClose()
    } catch (err: any) { toast(err.message || 'Enrollment failed', 'err') }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm grid place-items-center z-[60] p-5"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="card p-6 w-[min(460px,96vw)] animate-in">
        <h2 className="text-lg font-bold mb-4">Enroll employee</h2>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <input className="input" placeholder="Emp ID" value={f.emp_id} onChange={(e) => setF({ ...f, emp_id: e.target.value })} required />
          <input className="input" placeholder="First name" value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} />
          <input className="input" placeholder="Last name" value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} />
        </div>

        <div className="aspect-video bg-black rounded-lg overflow-hidden grid place-items-center mb-3">
          {img ? <img src={img} className="w-full h-full object-contain" />
            : camOn ? <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            : <span className="text-muted text-sm">No photo yet</span>}
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {!camOn && !img && <button type="button" className="btn" onClick={startCam}>📷 Use camera</button>}
          {camOn && <button type="button" className="btn bg-brand text-white border-brand" onClick={capture}>Capture</button>}
          {img && <button type="button" className="btn" onClick={() => setImg('')}>Retake</button>}
          <label className="btn cursor-pointer">Upload<input type="file" accept="image/*" className="hidden" onChange={onFile} /></label>
        </div>

        <div className="flex gap-2">
          <button className="btn bg-brand text-white border-brand flex-1" disabled={busy}>{busy ? 'Enrolling…' : 'Enroll'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
        <p className="text-xs text-muted mt-2">Look <b>straight at the camera</b> with your <b>whole face centered</b> and well-lit. The capture is quality-checked — tilted, side-on, cut-off, or far-away faces are rejected with a reason.</p>
      </form>
    </div>
  )
}
