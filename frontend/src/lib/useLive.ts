import { useEffect, useState } from 'react'
import { makeSocket } from './socket'

export function useLive() {
  const [entries, setEntries] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const s = makeSocket()
    s.on('connect', () => setConnected(true))
    s.on('disconnect', () => setConnected(false))
    s.on('initial_attendance_data', (rows: any) => setEntries(Array.isArray(rows) ? rows : []))
    s.on('new_attendance_entry', (e: any) => setEntries((x) => [e, ...x]))
    s.on('attendance_statistics_update', (st: any) => setStats(st))
    return () => { s.disconnect() }
  }, [])

  return { entries, stats, connected }
}
