import { useEffect, useState } from 'react'
import type { EngineStats } from '@/protocol'
import { useServices } from './services'

const POLL_MS = 500

/** Live frame time and memory, so budget breaches are seen as they happen (plan: Memory rule 1). */
export function StatsOverlay() {
  const { engine } = useServices()
  const [stats, setStats] = useState<EngineStats>(() => engine.query('stats'))

  useEffect(() => {
    const timer = setInterval(() => setStats(engine.query('stats')), POLL_MS)
    return () => clearInterval(timer)
  }, [engine])

  const known = [stats.jsHeapBytes, stats.wasmHeapBytes, stats.gpuBytesEstimate]
  const total = known.reduce<number>((sum, bytes) => sum + (bytes ?? 0), 0)

  return (
    <dl className="pointer-events-none absolute top-2 right-2 grid grid-cols-[auto_auto] gap-x-3 rounded-md border bg-background/80 px-2 py-1.5 font-mono text-[0.625rem] leading-relaxed">
      <Row
        label="Frame (CPU)"
        value={stats.frameMs === null ? '—' : `${stats.frameMs.toFixed(1)} ms`}
      />
      <Row label="JS heap" value={megabytes(stats.jsHeapBytes)} />
      <Row label="WASM heap" value={megabytes(stats.wasmHeapBytes)} />
      <Row label="GPU (est.)" value={megabytes(stats.gpuBytesEstimate)} />
      <Row label="Total" value={megabytes(total)} />
    </dl>
  )
}

function Row(props: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="text-right tabular-nums">{props.value}</dd>
    </>
  )
}

function megabytes(bytes: number | null): string {
  return bytes === null ? '—' : `${(bytes / 1_048_576).toFixed(1)} MB`
}
