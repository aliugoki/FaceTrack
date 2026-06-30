import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Card, Spinner } from '../components/ui'
import { hlsUrl, webrtcUrl } from '../lib/streams'

function Player({ cam, online }: { cam: any; online: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const hls = hlsUrl(cam)
  const webrtc = webrtcUrl(cam)
  useEffect(() => {
    const v = ref.current
    if (!online || !hls || !v || webrtc) return  // WebRTC (iframe) takes priority below
    let player: Hls | null = null
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = hls                                // Safari native HLS
    } else if (Hls.isSupported()) {
      player = new Hls({ lowLatencyMode: true })
      player.loadSource(hls)
      player.attachMedia(v)
    }
    return () => { if (player) player.destroy() }
  }, [hls, webrtc, online])

  // A camera with a stream_path but no running pipeline would make the MediaMTX
  // reader retry/404 forever (console spam). Only mount a player when the feed is
  // actually publishing; otherwise show an offline placeholder.
  if (online && webrtc) return <iframe src={webrtc} className="w-full h-full border-0" allow="autoplay; fullscreen" />
  if (online && hls) return <video ref={ref} className="w-full h-full object-cover bg-black" autoPlay muted playsInline controls />
  if (!online && cam.stream_path) return (
    <div className="grid place-items-center h-full text-muted text-xs p-3 text-center">
      Pipeline offline.<br />Start this company's pipeline on the <b>Pipeline</b> page to view its live stream.
    </div>
  )
  return (
    <div className="grid place-items-center h-full text-muted text-xs p-3 text-center">
      No live stream.<br />RTSP source: <span className="break-all">{cam.rtsp_url || '—'}</span>
      <br />Enable this camera with an RTSP source and launch its pipeline to view here.
    </div>
  )
}

export default function Live() {
  const { can } = useAuth()
  const isFleet = can('view_tenants')              // super-admin sees the whole fleet
  const [cams, setCams] = useState<any[] | null>(null)
  const [liveUsers, setLiveUsers] = useState<Set<string> | null>(null)

  useEffect(() => {
    api('/api/cameras/live')
      .then((c: any) => setCams(c.filter((x: any) => x.enabled)))
      .catch(() => setCams([]))
    if (isFleet) {
      // Which companies' pipelines are actually publishing (so offline tenants
      // don't render a forever-retrying player). Only super-admins can read this.
      api('/api/pipeline/status')
        .then((s: any) => setLiveUsers(new Set(
          (s.pipelines || [])
            .filter((p: any) => ['healthy', 'degraded'].includes(p.state))
            .map((p: any) => p.admin_username))))
        .catch(() => setLiveUsers(new Set()))
    } else {
      setLiveUsers(null)                           // own company → assume publishable
    }
  }, [isFleet])

  // Is this camera's feed considered online/publishing?
  const isOnline = (c: any) => {
    if (!isFleet || !liveUsers) return true        // non-fleet view: render as before
    if (!c.stream_path) return false
    return liveUsers.has(c.stream_path.split('_cam')[0])
  }

  if (!cams || (isFleet && !liveUsers)) return <Spinner />
  if (!cams.length)
    return <Card title="Live wall"><p className="text-muted text-sm">No cameras configured. Add them in <b>Cameras</b> with an RTSP source — HLS/WebRTC stream URLs are generated automatically.</p></Card>

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(360px,1fr))' }}>
      {cams.map((c) => (
        <div key={c.id} className="card overflow-hidden">
          <div className="px-4 py-2.5 flex justify-between items-center border-b border-line">
            <b>{c.company_name ? `${c.company_name} · ${c.name}` : c.name}</b>
            <span className="text-xs text-muted">{c.location || c.type}</span>
          </div>
          <div className="aspect-video bg-black"><Player cam={c} online={isOnline(c)} /></div>
        </div>
      ))}
    </div>
  )
}
