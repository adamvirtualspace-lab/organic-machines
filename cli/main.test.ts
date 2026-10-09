import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from './main'

async function cli(...args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(args, { out: (t) => out.push(t), err: (t) => err.push(t) })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('cli', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'om-cli-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('switches mode from shell words and prints the state', async () => {
    const result = await cli('mode.set', 'machines')
    expect(result.code).toBe(0)
    expect(JSON.parse(result.out).mode).toBe('machines')
  })

  it('keeps a shell word with spaces as one value', async () => {
    const result = await cli('object.add', 'Front plate')
    expect(JSON.parse(result.out).objects).toEqual([
      { id: 'o1', name: 'Front plate', mode: 'organic' },
    ])
  })

  it('reports a bad command and exits non-zero', async () => {
    const result = await cli('mode.set', 'sideways')
    expect(result.code).toBe(1)
    expect(result.err).toContain('must be one of: organic, machines')
    expect(result.out).toBe('')
  })

  it('runs a script, saves the document, and loads it again', async () => {
    const script = join(dir, 'build.txt')
    const saved = join(dir, 'part.json')
    await writeFile(
      script,
      '# two objects, one per mode\nobject.add Blob\nmode.set machines\nobject.add Bracket\n',
    )

    expect((await cli('--script', script, '--out', saved)).code).toBe(0)
    expect(JSON.parse(await readFile(saved, 'utf8')).schemaVersion).toBe(1)

    const reloaded = await cli('--in', saved)
    expect(JSON.parse(reloaded.out).objects.map((o: { name: string }) => o.name)).toEqual([
      'Blob',
      'Bracket',
    ])
  })
})
