import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createEngine } from './engine'
import { createViewportHost } from './engine/render/viewport'
import './index.css'
import { App } from './ui/App'
import { ServicesContext, type Services } from './ui/services'

// The one place where the engine and the UI meet: everywhere else they only share /protocol.
const engine = createEngine()
const services: Services = { engine, viewport: createViewportHost(engine) }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServicesContext value={services}>
      <App />
    </ServicesContext>
  </StrictMode>,
)
