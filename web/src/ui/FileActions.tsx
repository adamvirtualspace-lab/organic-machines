import { useRef } from 'react'
import { FilePlus, FolderOpen, Save } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'
import { useEngineState, useRun, useServices } from './services'
import { useUi } from './store'

const FILE_NAME = 'model.organic-machines.json'

/** New, open and save for the document. Files are plain JSON, so they work the same on Android. */
export function FileActions() {
  const { engine } = useServices()
  const { objects } = useEngineState()
  const run = useRun()
  const picker = useRef<HTMLInputElement>(null)

  function startNew(): void {
    if (objects.length > 0 && !window.confirm('Start a new document? This cannot be undone.'))
      return
    void run({ name: 'doc.new', params: {} })
  }

  function save(): void {
    const url = URL.createObjectURL(
      new Blob([engine.query('doc.serialize')], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = FILE_NAME
    link.click()
    URL.revokeObjectURL(url)
  }

  async function open(file: File | undefined): Promise<void> {
    if (!file) return
    // The command's text form would dump the whole file into the console, so name the file instead.
    const { log, showConsole } = useUi.getState()
    log('input', `doc.load  (${file.name})`)
    const result = await engine.execute({ name: 'doc.load', params: { data: await file.text() } })
    if (!result.ok) {
      log('error', result.error)
      showConsole()
    }
    if (picker.current) picker.current.value = '' // So picking the same file again still fires.
  }

  return (
    <div className="flex shrink-0 items-center">
      <Button variant="ghost" size="icon-sm" aria-label="New document" onClick={startNew}>
        <FilePlus />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Open a file"
        onClick={() => picker.current?.click()}
      >
        <FolderOpen />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Save to a file" onClick={save}>
        <Save />
      </Button>
      <input
        ref={picker}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => void open(event.target.files?.[0])}
      />
    </div>
  )
}
