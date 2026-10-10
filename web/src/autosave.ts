import type { EngineApi } from './protocol'

const KEY = 'organic-machines:autosave'
const DELAY_MS = 600

/**
 * Keeps the document in browser storage so a refresh does not lose it: restores the last save
 * on start, then writes shortly after every change. Storage being full or blocked is not fatal,
 * so failures only warn.
 */
export async function startAutosave(engine: EngineApi): Promise<void> {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) {
      const result = await engine.execute({ name: 'doc.load', params: { data: saved } })
      if (!result.ok) console.warn(`The autosaved document was not restored: ${result.error}`)
    }
  } catch (error) {
    console.warn('Browser storage is unavailable, so this session will not autosave.', error)
    return
  }

  let timer = 0
  let last = engine.query('state').objects
  engine.subscribe('state.changed', (state) => {
    // Selection and mode changes report too; only a changed document is worth writing.
    if (state.objects === last) return
    last = state.objects
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, engine.query('doc.serialize'))
      } catch (error) {
        console.warn('Autosave failed.', error)
      }
    }, DELAY_MS)
  })
}
