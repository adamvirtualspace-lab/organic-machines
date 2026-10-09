/** Bump this whenever the saved document shape changes, and add a migration below. */
export const SCHEMA_VERSION = 1

export type RawDocument = Record<string, unknown>
export type Migration = (raw: RawDocument) => RawDocument

/**
 * Keyed by the version a migration upgrades *from*; each returns the next version's shape
 * with `schemaVersion` already advanced. Empty until the schema first changes.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {}
