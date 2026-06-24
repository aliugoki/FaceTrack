import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, Spinner } from '../components/ui'
import { fmtDate, fmtTime } from '../lib/socket'

export default function Recordings() {
  const [list, setList] = useState<any[] | null>(null)
  const [sel, setSel] = useState<any>(null)
  useEffect(() => { api('/api/recordings').then(setList).catch(() => setList([])) }, [])
  if (!list) return <Spinner />

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <Card title="Recordings" className="lg:col-span-1" right={<span className="text-xs text-muted">{list.length}</span>}>
        <div className="flex flex-col gap-1 max-h-[70vh] overflow-auto">
          {list.map((r) => (
            <button key={r.path} onClick={() => setSel(r)}
              className={`text-left px-3 py-2 rounded-lg ${sel?.path === r.path ? 'bg-brand/15' : 'hover:bg-surface2'}`}>
              <div className="text-sm font-medium truncate">{r.camera}</div>
              <div className="text-xs text-muted">{fmtDate(r.modified)} {fmtTime(r.modified)} · {r.size_mb} MB</div>
            </button>
          ))}
          {!list.length && <p className="text-muted text-sm">No recordings found. Ensure MediaMTX is recording to the mounted directory.</p>}
        </div>
      </Card>
      <Card title={sel ? sel.file : 'Player'} className="lg:col-span-2">
        {sel
          ? <video key={sel.path} src={sel.url} className="w-full rounded-lg bg-black" controls autoPlay />
          : <p className="text-muted text-sm">Select a recording to play.</p>}
      </Card>
    </div>
  )
}
