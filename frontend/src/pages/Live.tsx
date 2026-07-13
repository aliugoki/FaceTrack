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

function CameraTile({ cam, online }: { cam: any; online: boolean }) {
  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <div className="px-3 py-2 flex justify-between items-center border-b border-line">
        <b>{cam.name}</b>
        <span className="text-xs text-muted">{cam.location || cam.type}</span>
      </div>
      <div className="aspect-video bg-black"><Player cam={cam} online={online} /></div>
    </div>
  )
}

const GRID = { gridTemplateColumns: 'repeat(auto-fill,minmax(360px,1fr))' } as const

export default function Live() {
  const { can } = useAuth()
  const isFleet = can('view_tenants')              // super-admin sees the whole fleet
  const [cams, setCams] = useState<any[] | null>(null)
  const [liveUsers, setLiveUsers] = useState<Set<string> | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

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

  // Company users: flat grid of their own cameras (unchanged).
  if (!isFleet)
    return (
      <div className="grid gap-4" style={GRID}>
        {cams.map((c) => <CameraTile key={c.id} cam={c} online={isOnline(c)} />)}
      </div>
    )

  // Super-admins: group by company into collapsible sections so a company's
  // cameras aren't mixed together across the whole fleet.
  const groups = new Map<string, any[]>()
  for (const c of cams) {
    const key = c.company_name || '—'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }
  const toggle = (name: string) => setCollapsed((prev) => {
    const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s
  })

  return (
    <div className="flex flex-col gap-4">
      {[...groups.entries()].map(([company, list]) => {
        const isCol = collapsed.has(company)
        const liveCount = list.filter(isOnline).length
        return (
          <div key={company} className="card overflow-hidden">
            <button onClick={() => toggle(company)}
              className="w-full px-4 py-3 flex justify-between items-center border-b border-line hover:bg-surface2">
              <b>{company} <span className="text-muted font-normal text-sm">· {list.length} camera{list.length !== 1 ? 's' : ''}</span></b>
              <span className="text-xs text-muted">
                <span className={liveCount ? 'text-ok' : ''}>{liveCount}/{list.length} live</span>
                <span className="ml-2">{isCol ? '▸' : '▾'}</span>
              </span>
            </button>
            {!isCol && (
              <div className="p-4 grid gap-4" style={GRID}>
                {list.map((c) => <CameraTile key={c.id} cam={c} online={isOnline(c)} />)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
