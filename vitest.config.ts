import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Tests run headless in Node: the engine core and protocol have no DOM dependency.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['web/src/**/*.test.ts', 'cli/**/*.test.ts'],
  },
})
