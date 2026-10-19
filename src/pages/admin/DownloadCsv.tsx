import { useState } from 'react'
import { Download } from 'lucide-react'
import { toastError } from '../../components/ui/toast'

/* Admin: the "Download CSV" button of the intake lists. The export routes need the bearer token, so the file is
   fetched with it and saved from a blob (a plain link could not send the header). The server already prefixes any
   cell that starts with = + - @ so a spreadsheet never runs it. */

export function DownloadCsv({ token, path, filename }: { token: string; path: string; filename: string }) {
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    try {
      const r = await fetch(path, { headers: { authorization: `Bearer ${token}` } })
      if (!r.ok) throw new Error()
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      toastError('The CSV could not be downloaded.')
    }
    setBusy(false)
  }
  return (
    <button type="button" onClick={go} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line px-4 font-mono text-[12px] text-muted transition-colors hover:text-ink disabled:opacity-50">
      <Download size={14} aria-hidden /> Download CSV
    </button>
  )
}
