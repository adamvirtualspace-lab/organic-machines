// Headless entry point: nothing exported from here may pull in rendering code,
// so the CLI and tests can load the engine in Node. The viewport lives in ./render.
export { createEngine, type Engine, type ViewDelegate } from './engine'
