import { describe, expect, it } from 'vitest'
import type { Document } from '../doc/document'
import { SCHEMA_VERSION, type Migration } from '../doc/schema'
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
      0: ({ items, ...rest }) => ({ ...rest, schemaVersion: 1, units: 'mm', objects: items }),
    }
    expect(deserializeDocument(old, migrations)).toEqual({
      schemaVersion: SCHEMA_VERSION,
      units: 'mm',
      nextId: 2,
      objects: [{ id: 'o1', name: 'Blob', mode: 'organic' }],
    })
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
