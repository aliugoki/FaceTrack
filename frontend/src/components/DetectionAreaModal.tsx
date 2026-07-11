import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { api } from '../lib/api'
import { toast } from './ui'
import { hlsUrl } from '../lib/streams'

/**
 * Draw a per-camera detection zone (polygon) over the camera's live view.
 * Points are stored normalized (0..1) so they're resolution-independent; the
 * pipeline scales them to its 1280x720 frame. Empty polygon = whole frame.
 * Takes effect on the next pipeline (re)start.
 */
export default function DetectionAreaModal({ cam, onClose, onSaved }: any) {
  const vref = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pts, setPts] = useState<number[][]>(Array.isArray(cam.detection_area) ? cam.detection_area : [])
  const [saving, setSaving] = useState(false)
  const hls = hlsUrl(cam)

  useEffect(() => {
    const v = vref.current
    if (!hls || !v) return
    let player: Hls | null = null
    if (v.canPlayType('application/vnd.apple.mpegurl')) v.src = hls
    else if (Hls.isSupported()) { player = new Hls({ lowLatencyMode: true }); player.loadSource(hls); player.attachMedia(v) }
    return () => { if (player) player.destroy() }
  }, [hls])

  const addPoint = (e: React.MouseEvent) => {
    const r = boxRef.current!.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    setPts([...pts, [+x.toFixed(4), +y.toFixed(4)]])
  }
  const save = async () => {
    if (pts.length && pts.length < 3) { toast('Add at least 3 points, or Clear to use the whole frame', 'err'); return }
    setSaving(true)
    try {
      const r = await api(`/api/cameras/${cam.id}/area`, { method: 'PUT', body: { detection_area: pts } })
      toast(r && r.restart_queued
        ? 'Detection area saved — pipeline restarting to apply…'
        : 'Detection area saved — start this camera’s pipeline to apply', 'ok')
      onSaved && onSaved(pts); onClose()
    } catch (e: any) { toast(e.message || 'Save failed', 'err') } finally { setSaving(false) }
  }

  const polyPoints = pts.map((p) => p.join(',')).join(' ')

  return (
    <div className="fixed inset-0 bg-black/70 grid place-items-center z-50 p-4" onClick={onClose}>
      <div className="card w-full max-w-3xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-2.5 border-b border-line flex justify-between items-center">
          <b>Detection area — {cam.company_name ? cam.company_name + ' · ' : ''}{cam.name}</b>
          <button className="btn" onClick={onClose}>✕</button>
        </div>
        <div className="p-4">
          <div ref={boxRef} onClick={addPoint}
               className="relative w-full bg-black rounded-lg overflow-hidden cursor-crosshair select-none"
               style={{ aspectRatio: '16 / 9' }}>
            {hls
              ? <video ref={vref} className="absolute inset-0 w-full h-full object-cover pointer-events-none" autoPlay muted playsInline />
              : <div className="absolute inset-0 grid place-items-center text-muted text-xs text-center px-6 pointer-events-none">
                  No live stream — start this camera's pipeline to draw over the live view.<br />You can still place points on the frame.
                </div>}
            {/* Polygon fill + outline (stretched 0..1 space; non-scaling stroke keeps it crisp). */}
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
              {pts.length >= 2 &&
                <polygon points={polyPoints} fill="rgba(22,198,12,0.18)" stroke="#16c60c"
                         strokeWidth={2} vectorEffect="non-scaling-stroke" />}
            </svg>
            {/* Point markers as HTML so they stay circular regardless of aspect. */}
            {pts.map((p, i) => (
              <div key={i} className="absolute w-2.5 h-2.5 rounded-full bg-[#16c60c] border border-white pointer-events-none"
                   style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%`, transform: 'translate(-50%,-50%)' }} />
            ))}
          </div>
          <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
            <div className="text-xs text-muted">
              {pts.length} point{pts.length === 1 ? '' : 's'} · click to add · attendance triggers <b>only inside</b> the zone (empty = whole frame)
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => setPts(pts.slice(0, -1))} disabled={!pts.length}>Undo</button>
              <button className="btn" onClick={() => setPts([])} disabled={!pts.length}>Clear</button>
              <button className="btn bg-brand text-white border-brand" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
