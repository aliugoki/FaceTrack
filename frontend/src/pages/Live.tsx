import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { api } from '../lib/api'
import { Card, Spinner } from '../components/ui'

function Player({ cam }: { cam: any }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!cam.hls_url || !v) return
    let hls: Hls | null = null
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = cam.hls_url            // Safari native HLS
    } else if (Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: true })
      hls.loadSource(cam.hls_url)
      hls.attachMedia(v)
    }
    return () => { if (hls) hls.destroy() }
  }, [cam.hls_url])

  if (cam.webrtc_url) return <iframe src={cam.webrtc_url} className="w-full h-full border-0" allow="autoplay; fullscreen" />
  if (cam.hls_url) return <video ref={ref} className="w-full h-full object-cover bg-black" autoPlay muted playsInline controls />
  return (
    <div className="grid place-items-center h-full text-muted text-xs p-3 text-center">
      No playback URL set.<br />RTSP source: <span className="break-all">{cam.rtsp_url || '—'}</span>
      <br />Set an HLS/WebRTC URL in Cameras to view here.
    </div>
  )
}

export default function Live() {
  const [cams, setCams] = useState<any[] | null>(null)
  useEffect(() => { api('/api/cameras').then((c: any) => setCams(c.filter((x: any) => x.enabled))).catch(() => setCams([])) }, [])
  if (!cams) return <Spinner />
  if (!cams.length)
    return <Card title="Live wall"><p className="text-muted text-sm">No cameras configured. Add them in <b>Cameras</b> with an HLS or WebRTC URL to see live video here.</p></Card>

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(360px,1fr))' }}>
      {cams.map((c) => (
        <div key={c.id} className="card overflow-hidden">
          <div className="px-4 py-2.5 flex justify-between items-center border-b border-line">
            <b>{c.name}</b><span className="text-xs text-muted">{c.location || c.type}</span>
          </div>
          <div className="aspect-video bg-black"><Player cam={c} /></div>
        </div>
      ))}
    </div>
  )
}
