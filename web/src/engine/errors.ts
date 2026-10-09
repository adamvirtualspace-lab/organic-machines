/** An error the user can act on. `execute` reports it as a failed result instead of throwing. */
export class CommandError extends Error {
  override name = 'CommandError'
}
