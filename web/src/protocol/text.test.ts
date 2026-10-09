import { describe, expect, it } from 'vitest'
import { formatCommand, parseCommand } from './text'

describe('parseCommand', () => {
  it('reads named parameters', () => {
    expect(parseCommand('mode.set mode=machines')).toEqual({
      ok: true,
      command: { name: 'mode.set', params: { mode: 'machines' } },
    })
  })

  it('fills positional parameters in order', () => {
    expect(parseCommand('object.rename o3 Bracket')).toEqual({
      ok: true,
      command: { name: 'object.rename', params: { id: 'o3', name: 'Bracket' } },
    })
  })

  it('keeps quoted text together, with escapes', () => {
    expect(parseCommand('object.rename id=o1 name="Front \\"A\\" plate"')).toEqual({
      ok: true,
      command: { name: 'object.rename', params: { id: 'o1', name: 'Front "A" plate' } },
    })
  })

  it('treats key=value as positional when the key is not a parameter', () => {
    expect(parseCommand('object.add a=b')).toEqual({
      ok: true,
      command: { name: 'object.add', params: { name: 'a=b' } },
    })
  })

  it('turns number parameters into numbers', () => {
    expect(parseCommand('organic.set o1 n3 position.x -12.5')).toEqual({
      ok: true,
      command: {
        name: 'organic.set',
        params: { id: 'o1', node: 'n3', param: 'position.x', value: -12.5 },
      },
    })
  })

  it('leaves optional parameters out', () => {
    expect(parseCommand('  object.add  ')).toEqual({
      ok: true,
      command: { name: 'object.add', params: {} },
    })
  })

  it.each([
    ['', 'Empty command'],
    ['fly away', 'Unknown command "fly"'],
    ['mode.set', 'mode.set needs "mode"'],
    ['mode.set sideways', '"mode" must be one of: organic, machines'],
    ['undo now', 'Unexpected "now" for undo'],
    ['mode.set organic mode=machines', '"mode" is given twice'],
    ['object.add "open', 'Unclosed quote'],
    ['organic.set o1 n3 radius big', '"value" must be a number'],
    ['organic.set o1 n3 radius ""', '"value" must be a number'],
    ['organic.set o1 n3 radius Infinity', '"value" must be a number'],
    ['view.set sideways', '"view" must be one of: front, back, left, right, top, bottom'],
  ])('rejects %j', (text, error) => {
    expect(parseCommand(text)).toEqual({ ok: false, error })
  })
})

describe('formatCommand', () => {
  it('writes text that parses back to the same command', () => {
    const command = {
      name: 'object.rename',
      params: { id: 'o1', name: 'Front "A" plate' },
    } as const
    const text = formatCommand(command)
    expect(text).toBe('object.rename id=o1 name="Front \\"A\\" plate"')
    expect(parseCommand(text)).toEqual({ ok: true, command })
  })

  it('writes a command with no parameters as just its name', () => {
    expect(formatCommand({ name: 'undo', params: {} })).toBe('undo')
  })
})
