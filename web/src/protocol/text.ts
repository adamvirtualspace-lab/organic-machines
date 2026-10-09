import { COMMAND_SPECS, isCommandName, type Command, type CommandSpec } from './commands'

export type ParseResult = { ok: true; command: Command } | { ok: false; error: string }

/**
 * Parses the text form of a command, e.g. `object.rename id=o1 name="Front plate"`.
 * Words without `key=` fill the command's positional parameters in order.
 */
export function parseCommand(text: string): ParseResult {
  const tokens = tokenize(text)
  if (typeof tokens === 'string') return fail(tokens)
  const [name, ...words] = tokens
  if (name === undefined) return fail('Empty command')
  if (!isCommandName(name)) return fail(`Unknown command "${name}"`)

  const spec: CommandSpec = COMMAND_SPECS[name]
  const positional = [...(spec.positional ?? [])]
  const params: Record<string, string> = {}

  for (const word of words) {
    const eq = word.indexOf('=')
    const key = eq > 0 ? word.slice(0, eq) : undefined
    const named = key !== undefined && Object.hasOwn(spec.params, key)
    const target = named ? key : positional.shift()
    if (target === undefined) return fail(`Unexpected "${word}" for ${name}`)
    if (Object.hasOwn(params, target)) return fail(`"${target}" is given twice`)
    params[target] = named ? word.slice(eq + 1) : word
  }

  for (const [key, param] of Object.entries(spec.params)) {
    const value = params[key]
    if (value === undefined) {
      if (!param.optional) return fail(`${name} needs "${key}"`)
    } else if (param.type === 'enum' && !param.values.includes(value)) {
      return fail(`"${key}" must be one of: ${param.values.join(', ')}`)
    }
  }
  // The spec table is typed against CommandParams, so checked params match the command's shape.
  return { ok: true, command: { name, params } as unknown as Command }
}

export function formatCommand(command: Command): string {
  const parts: string[] = [command.name]
  for (const [key, value] of Object.entries(command.params)) {
    if (value !== undefined) parts.push(`${key}=${quote(String(value))}`)
  }
  return parts.join(' ')
}

function fail(error: string): ParseResult {
  return { ok: false, error }
}

function quote(value: string): string {
  if (value !== '' && !/[\s"\\]/.test(value)) return value
  return `"${value.replace(/[\\"]/g, '\\$&')}"`
}

/** Splits on whitespace, keeping double-quoted stretches (with \" and \\ escapes) together. */
function tokenize(text: string): string[] | string {
  const tokens: string[] = []
  let current = ''
  let started = false
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '\\' && i + 1 < text.length) current += text[++i]
      else if (ch === '"') inQuotes = false
      else current += ch
    } else if (ch === '"') {
      inQuotes = true
      started = true
    } else if (/\s/.test(ch)) {
      if (started) tokens.push(current)
      current = ''
      started = false
    } else {
      current += ch
      started = true
    }
  }
  if (inQuotes) return 'Unclosed quote'
  if (started) tokens.push(current)
  return tokens
}
