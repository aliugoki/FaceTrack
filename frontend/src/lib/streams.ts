// Browser-relative HLS/WebRTC URLs for a camera's annotated live stream.
//
// The streaming gateway (MediaMTX) runs on the SAME host that serves this app
// (single origin), so we build stream URLs from window.location — any client
// that can reach the dashboard can reach the streams, with no IP baked in.
//
// A camera's `stream_path` (e.g. "comet_cam0") is assigned by the backend and
// matches the DeepStream pipeline's per-camera RTSP mount and the MediaMTX path.
// A manually-set hls_url / webrtc_url on the camera overrides the derived URL.
//
// Note: MediaMTX serves HLS/WebRTC over plain HTTP on these ports. If the
// dashboard is served over HTTPS, terminate TLS for these ports too (or proxy
// them) to avoid mixed-content blocking.

export const HLS_PORT = 8888
export const WEBRTC_PORT = 8889

function base(port: number): string {
  const { protocol, hostname } = window.location
  return `${protocol}//${hostname}:${port}`
}

/** HLS playlist URL for a camera, or null if it has no stream. */
export function hlsUrl(cam: any): string | null {
  if (cam?.hls_url) return cam.hls_url
  if (!cam?.stream_path) return null
  return `${base(HLS_PORT)}/${cam.stream_path}/index.m3u8`
}

/** WebRTC (MediaMTX WHEP reader) URL for a camera, or null. */
export function webrtcUrl(cam: any): string | null {
  if (cam?.webrtc_url) return cam.webrtc_url
  if (!cam?.stream_path) return null
  return `${base(WEBRTC_PORT)}/${cam.stream_path}`
}

/** True if the camera has any playable live stream. */
export function hasStream(cam: any): boolean {
  return !!(hlsUrl(cam) || webrtcUrl(cam))
}
