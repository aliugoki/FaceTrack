import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { api } from '../lib/api'
import { Card, Spinner } from '../components/ui'
import { hlsUrl, webrtcUrl } from '../lib/streams'

function Player({ cam }: { cam: any }) {
  const ref = useRef<HTMLVideoElement>(null)
  const hls = hlsUrl(cam)
  const webrtc = webrtcUrl(cam)
  useEffect(() => {
    const v = ref.current
    if (!hls || !v || webrtc) return            // WebRTC (iframe) takes priority below
    let player: Hls | null = null
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = hls                                // Safari native HLS
    } else if (Hls.isSupported()) {
      player = new Hls({ lowLatencyMode: true })
      player.loadSource(hls)
      player.attachMedia(v)
    }
    return () => { if (player) player.destroy() }
  }, [hls, webrtc])

  if (webrtc) return <iframe src={webrtc} className="w-full h-full border-0" allow="autoplay; fullscreen" />
  if (hls) return <video ref={ref} className="w-full h-full object-cover bg-black" autoPlay muted playsInline controls />
  return (
    <div className="grid place-items-center h-full text-muted text-xs p-3 text-center">
      No live stream.<br />RTSP source: <span className="break-all">{cam.rtsp_url || '—'}</span>
      <br />Enable this camera with an RTSP source and launch its pipeline to view here.
    </div>
  )
}

export default function Live() {
  const [cams, setCams] = useState<any[] | null>(null)
  useEffect(() => { api('/api/cameras').then((c: any) => setCams(c.filter((x: any) => x.enabled))).catch(() => setCams([])) }, [])
  if (!cams) return <Spinner />
  if (!cams.length)
    return <Card title="Live wall"><p className="text-muted text-sm">No cameras configured. Add them in <b>Cameras</b> with an RTSP source — HLS/WebRTC stream URLs are generated automatically.</p></Card>

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
