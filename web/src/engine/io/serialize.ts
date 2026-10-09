import { MODES, type Mode } from '../../protocol'
import type { DocObject, Document } from '../doc/document'
import { MIGRATIONS, SCHEMA_VERSION, type Migration, type RawDocument } from '../doc/schema'
import { CommandError } from '../errors'

const APP_ID = 'organic-machines'

export function serializeDocument(doc: Document): string {
  return JSON.stringify({ app: APP_ID, ...doc }, null, 2)
}

/**
 * Reads save-file text, migrating older schema versions forward. Throws a CommandError
 * the user can read if the file is not ours, is damaged, or is from a newer version.
 */
export function deserializeDocument(
  text: string,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): Document {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new CommandError('This file is not valid JSON')
  }
  if (!isRecord(raw) || raw.app !== APP_ID) {
    throw new CommandError('This is not an Organic Machines file')
  }

  let version = raw.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new CommandError('This file has no valid schema version')
  }
  if (version > SCHEMA_VERSION) {
    throw new CommandError(
      `This file was saved by a newer version of Organic Machines ` +
        `(schema ${version}; this build reads up to ${SCHEMA_VERSION})`,
    )
  }

  let current: RawDocument = raw
  while (version < SCHEMA_VERSION) {
    const migrate = migrations[version]
    if (!migrate) throw new CommandError(`No migration from schema ${version}`)
    current = migrate(current)
    version += 1
  }
  return validate(current)
}

function validate(raw: RawDocument): Document {
  const { units, nextId, objects } = raw
  if (units !== 'mm' || typeof nextId !== 'number' || !Array.isArray(objects)) {
    throw new CommandError('This file is damaged: the document header is incomplete')
  }
  const seen = new Set<string>()
  const parsed = objects.map((item: unknown, index): DocObject => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      !isMode(item.mode) ||
      seen.has(item.id)
    ) {
      throw new CommandError(`This file is damaged: object ${index + 1} is invalid`)
    }
    seen.add(item.id)
    return { id: item.id, name: item.name, mode: item.mode }
  })
  return { schemaVersion: SCHEMA_VERSION, units, nextId, objects: parsed }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}
