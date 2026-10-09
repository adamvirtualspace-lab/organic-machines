import { useEffect, useRef, useState } from 'react'
import type { ViewportSupport } from '@/protocol'
import { useServices } from './services'

/** Hands the engine a place to draw. All rendering and camera input happens on the engine side. */
export function Viewport() {
  const { viewport } = useServices()
  const container = useRef<HTMLDivElement>(null)
  const [support, setSupport] = useState<ViewportSupport | null>(null)

  useEffect(() => {
    let current = true
    void viewport.checkSupport().then((result) => {
      if (current) setSupport(result)
    })
    return () => {
      current = false
    }
  }, [viewport])

  useEffect(() => {
    if (support?.ok && container.current) return viewport.attach(container.current)
  }, [support, viewport])

  if (support && !support.ok) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6 select-text">
        <div className="max-w-sm rounded-lg border bg-card p-5 text-card-foreground">
          <h2 className="font-heading text-sm font-medium">The 3D view cannot start</h2>
          <p className="mt-2 text-muted-foreground">{support.reason}</p>
          <p className="mt-2 text-muted-foreground">
            Organic Machines needs WebGPU. Use a current version of Chrome or Edge on desktop, or
            Chrome on Android 12 or newer.
          </p>
        </div>
      </div>
    )
  }
  return <div ref={container} className="absolute inset-0 touch-none" />
}
