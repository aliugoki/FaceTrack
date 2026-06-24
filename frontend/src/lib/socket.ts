import { io, Socket } from 'socket.io-client'
import { getToken } from './api'

export function makeSocket(): Socket {
  return io('/', {
    path: '/socket.io',
    auth: { token: getToken() },
    transports: ['websocket', 'polling'],
  })
}

export const fullName = (e: any) => `${e?.first_name || ''} ${e?.last_name || ''}`.trim() || 'Unknown'
export const fmtTime = (iso?: string) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'
export const fmtDate = (iso?: string) => iso ? new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
