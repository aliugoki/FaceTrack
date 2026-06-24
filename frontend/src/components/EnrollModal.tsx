import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision'
import { api } from '../lib/api'
import { toast } from './ui'

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'

export default function EnrollModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ emp_id: '', first_name: '', last_name: '' })
  const [img, setImg] = useState('')
  const [busy, setBusy] = useState(false)
  const [camOn, setCamOn] = useState(false)
  const [status, setStatus] = useState<{ text: string; ok: boolean; checks: { label: string; pass: boolean }[] }>(
    { text: 'Starting camera…', ok: false, checks: [] })

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<FaceDetector | null>(null)
  const rafRef = useRef<number>(0)
  const alignedRef = useRef(0)
  const capturedRef = useRef(false)

  const stopCam = () => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null; setCamOn(false)
  }
  useEffect(() => () => stopCam(), [])

  const ensureDetector = async () => {
    if (detectorRef.current) return detectorRef.current
    const vision = await FilesetResolver.forVisionTasks(WASM)
    detectorRef.current = await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO', minDetectionConfidence: 0.5,
    })
    return detectorRef.current
  }

  const startCam = async () => {
    setImg(''); capturedRef.current = false; alignedRef.current = 0
    // getUserMedia exists only in a secure context (HTTPS or localhost). Over a
    // plain-HTTP LAN origin navigator.mediaDevices is undefined → give a precise hint.
    if (!navigator.mediaDevices?.getUserMedia) {
      toast(window.isSecureContext
        ? 'Camera API unavailable in this browser — use Upload instead'
        : 'Camera blocked: open this page over HTTPS (or via localhost). Use Upload for now.', 'err')
      return
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } })
      streamRef.current = s; setCamOn(true)
      const v = videoRef.current!; v.srcObject = s; await v.play()
      let det: FaceDetector | null = null
      try { det = await ensureDetector() } catch { setStatus({ text: 'Live guide unavailable — capture manually', ok: false, checks: [] }) }
      loop(det)
    } catch (err: any) {
      const name = err?.name
      toast(name === 'NotAllowedError' ? 'Camera permission denied — allow it in the browser and retry'
        : name === 'NotFoundError' ? 'No camera found on this device — use Upload instead'
        : `Camera unavailable (${name || 'error'}) — use Upload instead`, 'err')
    }
  }

  // Alignment evaluation in normalized [0,1] frame coords → checklist + first action to fix
  const evaluate = (d: any) => {
    if (!d) return { ok: false, text: 'No face detected — look at the camera', checks: [{ label: 'Face detected', pass: false }] }
    const bb = d.boundingBox, k = d.keypoints
    const vw = videoRef.current!.videoWidth, vh = videoRef.current!.videoHeight
    const cx = (bb.originX + bb.width / 2) / vw, cy = (bb.originY + bb.height / 2) / vh
    const bw = bb.width / vw
    let yaw = 0.5, roll = 0
    if (k && k.length >= 3) {
      const re = k[0], le = k[1], no = k[2]
      const ex0 = Math.min(re.x, le.x), ex1 = Math.max(re.x, le.x)
      yaw = ex1 - ex0 > 1e-3 ? (no.x - ex0) / (ex1 - ex0) : 0.5
      const r = Math.abs(Math.atan2(le.y - re.y, le.x - re.x) * 180 / Math.PI)
      roll = Math.min(r, Math.abs(180 - r))
    }
    const distOk = bw >= 0.30 && bw <= 0.66
    const centerOk = Math.abs(cx - 0.5) <= 0.13 && Math.abs(cy - 0.5) <= 0.15
    const frontalOk = yaw >= 0.36 && yaw <= 0.64
    const levelOk = roll <= 12
    const checks = [
      { label: 'Face detected', pass: true },
      { label: 'Good distance', pass: distOk },
      { label: 'Centered in oval', pass: centerOk },
      { label: 'Looking straight', pass: frontalOk },
      { label: 'Head upright', pass: levelOk },
    ]
    let text = 'Hold still — capturing…'
    if (!distOk) text = bw < 0.30 ? 'Move closer to the camera' : 'Move back a little'
    else if (!centerOk) text = 'Center your face in the oval'
    else if (!frontalOk) text = 'Look straight at the camera'
    else if (!levelOk) text = 'Keep your head upright'
    return { ok: distOk && centerOk && frontalOk && levelOk, text, checks }
  }

  const HOLD = 12  // aligned frames required before auto-capture

  const draw = (ok: boolean, progress = 0) => {
    const c = canvasRef.current, v = videoRef.current; if (!c || !v) return
    const W = v.clientWidth, H = v.clientHeight; c.width = W; c.height = H
    const ctx = c.getContext('2d')!; ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H)
    const rx = W * 0.30, ry = H * 0.40, cx = W / 2, cy = H * 0.48
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore()
    // base ring
    ctx.lineWidth = 4
    ctx.strokeStyle = ok ? 'rgba(39,215,150,0.35)' : 'rgb(255,180,84)'
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke()
    // countdown progress arc fills clockwise from the top while aligned
    if (ok && progress > 0) {
      const start = -Math.PI / 2, end = start + Math.PI * 2 * Math.min(progress, 1)
      ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgb(39,215,150)'
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, start, end); ctx.stroke()
    }
  }

  const loop = (det: FaceDetector | null) => {
    const v = videoRef.current
    if (!v || !streamRef.current) return
    if (det && v.readyState >= 2) {
      try {
        const res = det.detectForVideo(v, performance.now())
        const ev = evaluate(res.detections[0] || null)
        alignedRef.current = ev.ok ? alignedRef.current + 1 : 0
        setStatus(ev); draw(ev.ok, alignedRef.current / HOLD)
        if (alignedRef.current >= HOLD && !capturedRef.current) { capturedRef.current = true; doCapture() }
      } catch { /* transient */ }
    }
    rafRef.current = requestAnimationFrame(() => loop(det))
  }

  const doCapture = () => {
    const v = videoRef.current; if (!v) return
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    setImg(c.toDataURL('image/jpeg', 0.92)); stopCam()
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
      <form onSubmit={submit} className="card p-6 w-[min(480px,96vw)] animate-in">
        <h2 className="text-lg font-bold mb-4">Enroll employee</h2>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <input className="input" placeholder="Emp ID" value={f.emp_id} onChange={(e) => setF({ ...f, emp_id: e.target.value })} required />
          <input className="input" placeholder="First name" value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} />
          <input className="input" placeholder="Last name" value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} />
        </div>

        <div className="relative aspect-video bg-black rounded-lg overflow-hidden mb-3">
          {img ? <img src={img} className="w-full h-full object-contain" />
            : <>
                <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                {camOn && <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />}
                {camOn && (
                  <>
                    {/* Prominent validation banner */}
                    <div className={`absolute top-0 inset-x-0 px-3 py-2 text-center text-sm font-bold tracking-wide
                      ${status.ok ? 'bg-ok text-black' : status.checks.length <= 1 ? 'bg-bad text-white' : 'bg-amber-500 text-black'}`}>
                      {status.ok ? '✓ ' : status.checks.length <= 1 ? '⚠ ' : '◷ '}{status.text}
                    </div>
                    {/* Live checklist so the user sees exactly what passes */}
                    <div className="absolute bottom-2 left-2 flex flex-col gap-1">
                      {status.checks.map((c) => (
                        <span key={c.label} className={`px-2 py-0.5 rounded-md text-[11px] font-semibold flex items-center gap-1
                          ${c.pass ? 'bg-ok/90 text-black' : 'bg-black/65 text-white/80'}`}>
                          <span>{c.pass ? '✓' : '○'}</span>{c.label}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {!camOn && <div className="absolute inset-0 grid place-items-center text-muted text-sm">No photo yet</div>}
              </>}
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {!camOn && !img && <button type="button" className="btn" onClick={startCam}>📷 Use camera (auto-capture)</button>}
          {camOn && <button type="button" className="btn" onClick={doCapture}>Capture now</button>}
          {img && <button type="button" className="btn" onClick={startCam}>Retake</button>}
          <label className="btn cursor-pointer">Upload<input type="file" accept="image/*" className="hidden" onChange={onFile} /></label>
        </div>

        <div className="flex gap-2">
          <button className="btn bg-brand text-white border-brand flex-1" disabled={busy}>{busy ? 'Enrolling…' : 'Enroll'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
        <p className="text-xs text-muted mt-2">Fit your face in the oval and look straight — it auto-captures when aligned. The server re-checks quality before saving.</p>
      </form>
    </div>
  )
}
