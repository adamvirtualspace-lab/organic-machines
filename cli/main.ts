import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createEngine } from '../web/src/engine'
import { parseCommand, parseCommandWords, type ParseResult } from '../web/src/protocol'

const USAGE = `Usage: npm run cli -- [options] [command words...]

Runs engine commands without a browser, then prints the resulting state as JSON.

Options:
  --in <file>      load a saved document first
  --out <file>     save the document afterwards
  --script <file>  run one command per line (blank lines and # comments are skipped)
  --help           show this text

Example:
  npm run cli -- mode.set machines
  npm run cli -- --out part.json object.add "Front plate"`

export interface CliIo {
  out(text: string): void
  err(text: string): void
}

/** Returns the process exit code. Stops at the first command that fails. */
export async function runCli(args: readonly string[], io: CliIo): Promise<number> {
  const options: Record<'in' | 'out' | 'script', string | undefined> = {
    in: undefined,
    out: undefined,
    script: undefined,
  }
  const rest = [...args]
  while (rest[0]?.startsWith('--')) {
    const flag = rest.shift()!.slice(2)
    if (flag === 'help') {
      io.out(USAGE)
      return 0
    }
    const value = rest.shift()
    if (!Object.hasOwn(options, flag) || value === undefined) {
      io.err(`Unknown or incomplete option "--${flag}"\n\n${USAGE}`)
      return 1
    }
    options[flag as keyof typeof options] = value
  }

  const commands: { label: string; parsed: ParseResult }[] = []
  if (options.script !== undefined) {
    const lines = (await readFile(options.script, 'utf8')).split(/\r?\n/)
    for (const line of lines.map((l) => l.trim())) {
      if (line && !line.startsWith('#')) commands.push({ label: line, parsed: parseCommand(line) })
    }
  }
  if (rest.length > 0) commands.push({ label: rest.join(' '), parsed: parseCommandWords(rest) })
  if (commands.length === 0 && options.in === undefined) {
    io.err(USAGE)
    return 1
  }

  const engine = createEngine()
  if (options.in !== undefined) {
    const data = await readFile(options.in, 'utf8')
    const loaded = await engine.execute({ name: 'doc.load', params: { data } })
    if (!loaded.ok) {
      io.err(`${options.in}: ${loaded.error}`)
      return 1
    }
  }
  for (const { label, parsed } of commands) {
    const result = parsed.ok ? await engine.execute(parsed.command) : parsed
    if (!result.ok) {
      io.err(`${label}: ${result.error}`)
      return 1
    }
  }
  if (options.out !== undefined) await writeFile(options.out, engine.query('doc.serialize'))

  io.out(JSON.stringify(engine.query('state'), null, 2))
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2), {
    out: (text) => console.log(text),
    err: (text) => console.error(text),
  })
}
