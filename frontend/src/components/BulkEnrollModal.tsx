import { useState } from 'react'
import { api } from '../lib/api'
import { toast } from './ui'

// Bulk enroll: one photo per employee (filename = emp_id), optional CSV for names.
// CSV header: emp_id,first_name,last_name
export default function BulkEnrollModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([])
  const [names, setNames] = useState<Record<string, { first: string; last: string }>>({})
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<{ emp: string; ok: boolean; msg: string }[]>([])
  const [done, setDone] = useState(0)

  const onCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const r = new FileReader()
    r.onload = () => {
      const map: Record<string, { first: string; last: string }> = {}
      String(r.result).split(/\r?\n/).forEach((line, i) => {
        const cols = line.split(',').map((c) => c.trim())
        if (i === 0 && /emp/i.test(cols[0])) return       // skip header
        if (cols[0]) map[cols[0]] = { first: cols[1] || '', last: cols[2] || '' }
      })
      setNames(map); toast(`Loaded ${Object.keys(map).length} names from CSV`, 'ok')
    }
    r.readAsText(file)
  }

  const readDataUrl = (f: File) => new Promise<string>((res) => {
    const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f)
  })

  const run = async () => {
    if (!files.length) return toast('Select employee photos first', 'err')
    setBusy(true); setResults([]); setDone(0)
    const out: { emp: string; ok: boolean; msg: string }[] = []
    for (const f of files) {
      const emp = f.name.replace(/\.[^.]+$/, '')      // filename without extension = emp_id
      const nm = names[emp] || { first: '', last: '' }
      try {
        const img = await readDataUrl(f)
        const r: any = await api('/api/employees/enroll', { method: 'POST', body: { emp_id: emp, first_name: nm.first, last_name: nm.last, image_b64: img } })
        out.push({ emp, ok: true, msg: `conf ${r.confidence}` })
      } catch (e: any) {
        out.push({ emp, ok: false, msg: e.message || 'failed' })
      }
      setDone((d) => d + 1); setResults([...out])
    }
    setBusy(false)
    const ok = out.filter((r) => r.ok).length
    toast(`Imported ${ok}/${out.length}`, ok ? 'ok' : 'err'); onDone()
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm grid place-items-center z-[60] p-5"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card p-6 w-[min(520px,96vw)] max-h-[92vh] overflow-auto animate-in">
        <h2 className="text-lg font-bold mb-1">Bulk import employees</h2>
        <p className="text-xs text-muted mb-4">Each photo's filename is the employee ID (e.g. <code>1023.jpg</code>). Optional CSV (<code>emp_id,first_name,last_name</code>) fills names.</p>
        <div className="flex flex-col gap-3 mb-4">
          <label className="text-sm">Photos
            <input className="input w-full mt-1" type="file" accept="image/*" multiple onChange={(e) => setFiles([...(e.target.files || [])])} /></label>
          <label className="text-sm">Names CSV (optional)
            <input className="input w-full mt-1" type="file" accept=".csv,text/csv" onChange={onCsv} /></label>
          <div className="text-xs text-muted">{files.length} photo(s) selected{busy ? ` · ${done}/${files.length} processed` : ''}</div>
        </div>
        {results.length > 0 && (
          <div className="max-h-48 overflow-auto mb-4 text-sm border border-line rounded-lg">
            {results.map((r) => (
              <div key={r.emp} className="flex justify-between px-3 py-1.5 border-b border-line/40">
                <span>{r.emp}</span><span className={r.ok ? 'text-ok' : 'text-bad'}>{r.ok ? '✓ ' : '✕ '}{r.msg}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <button className="btn bg-brand text-white border-brand flex-1" disabled={busy} onClick={run}>{busy ? `Importing… ${done}/${files.length}` : 'Start import'}</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
