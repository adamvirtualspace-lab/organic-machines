import { describe, expect, it } from 'vitest'
import type { Document } from '../doc/document'
import { MIGRATIONS, SCHEMA_VERSION, type Migration } from '../doc/schema'
import { deserializeDocument, serializeDocument } from './serialize'

const doc: Document = {
  schemaVersion: SCHEMA_VERSION,
  units: 'mm',
  nextId: 3,
  objects: [
    { id: 'o1', name: 'Blob', mode: 'organic' },
    { id: 'o2', name: 'Bracket', mode: 'machines' },
  ],
}

const file = (overrides: Record<string, unknown>) =>
  JSON.stringify({ app: 'organic-machines', ...doc, ...overrides })

describe('document save format', () => {
  it('round-trips a document', () => {
    expect(deserializeDocument(serializeDocument(doc))).toEqual(doc)
  })

  it('writes the schema version into the file', () => {
    expect(JSON.parse(serializeDocument(doc))).toMatchObject({
      app: 'organic-machines',
      schemaVersion: SCHEMA_VERSION,
    })
  })

  it('refuses a file from a newer version with a clear message', () => {
    expect(() => deserializeDocument(file({ schemaVersion: SCHEMA_VERSION + 1 }))).toThrow(
      `This file was saved by a newer version of Organic Machines (schema ${SCHEMA_VERSION + 1}; this build reads up to ${SCHEMA_VERSION})`,
    )
  })

  it('runs migrations in order on an older file', () => {
    // A pretend schema 0 that stored objects under "items" and had no units.
    const old = JSON.stringify({
      app: 'organic-machines',
      schemaVersion: 0,
      nextId: 2,
      items: [{ id: 'o1', name: 'Blob', mode: 'organic' }],
    })
    const migrations: Record<number, Migration> = {
      ...MIGRATIONS,
      0: ({ items, ...rest }) => ({ ...rest, schemaVersion: 1, units: 'mm', objects: items }),
    }
    expect(deserializeDocument(old, migrations)).toEqual({
      schemaVersion: SCHEMA_VERSION,
      units: 'mm',
      nextId: 2,
      objects: [{ id: 'o1', name: 'Blob', mode: 'organic' }],
    })
  })

  it('reads a version 1 file, from before objects had shapes', () => {
    expect(deserializeDocument(file({ schemaVersion: 1 }))).toEqual(doc)
  })

  it('round-trips an object with a shape, and rejects a damaged one', () => {
    const shaped: Document = {
      ...doc,
      objects: [
        {
          id: 'o1',
          name: 'Blob',
          mode: 'organic',
          sdf: { id: 'n1', kind: 'sphere', position: [1, 2, 3], radius: 4 },
        },
      ],
    }
    expect(deserializeDocument(serializeDocument(shaped))).toEqual(shaped)

    const broken = file({ objects: [{ ...shaped.objects[0], sdf: { id: 'n1', kind: 'sphere' } }] })
    expect(() => deserializeDocument(broken)).toThrow(
      'This file is damaged: in object 1, shape node "n1" has an invalid parameter',
    )
    const onMachines = file({ objects: [{ ...shaped.objects[0], mode: 'machines' }] })
    expect(() => deserializeDocument(onMachines)).toThrow(
      'This file is damaged: object 1 is invalid',
    )
  })

  it('refuses an older file it has no migration for', () => {
    expect(() => deserializeDocument(file({ schemaVersion: 0 }))).toThrow(
      'No migration from schema 0',
    )
  })

  it.each([
    ['text that is not JSON', 'nope', 'This file is not valid JSON'],
    ['another app', JSON.stringify({ app: 'other' }), 'This is not an Organic Machines file'],
    [
      'a missing version',
      file({ schemaVersion: undefined }),
      'This file has no valid schema version',
    ],
    [
      'a missing object list',
      file({ objects: undefined }),
      'This file is damaged: the document header is incomplete',
    ],
    [
      'an unknown mode',
      file({ objects: [{ id: 'o1', name: 'X', mode: 'liquid' }] }),
      'This file is damaged: object 1 is invalid',
    ],
    [
      'a repeated id',
      file({ objects: [doc.objects[0], doc.objects[0]] }),
      'This file is damaged: object 2 is invalid',
    ],
  ])('rejects %s', (_label, text, message) => {
    expect(() => deserializeDocument(text)).toThrow(message)
  })
})
