/** Bump this whenever the saved document shape changes, and add a migration below. */
export const SCHEMA_VERSION = 3

export type RawDocument = Record<string, unknown>
export type Migration = (raw: RawDocument) => RawDocument

/**
 * Keyed by the version a migration upgrades *from*; each returns the next version's shape
 * with `schemaVersion` already advanced.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // Version 2 added an optional `sdf` shape to Organic objects; older objects simply have none.
  1: (raw) => ({ ...raw, schemaVersion: 2 }),
  // Version 3 let shape nodes carry an optional name and a hidden flag.
  2: (raw) => ({ ...raw, schemaVersion: 3 }),
}
