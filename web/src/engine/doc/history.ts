interface Entry<T> {
  before: T
  after: T
}

/**
 * Snapshot undo: each entry keeps the state before and after one change, so undo and redo
 * swap references and never recompute. Capped by step count for now; the plan caps it by
 * memory once solids are involved.
 */
export class History<T> {
  private undoStack: Entry<T>[] = []
  private redoStack: Entry<T>[] = []

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  record(before: T, after: T): void {
    this.undoStack.push({ before, after })
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
  }

  undo(): T | undefined {
    const entry = this.undoStack.pop()
    if (entry) this.redoStack.push(entry)
    return entry?.before
  }

  redo(): T | undefined {
    const entry = this.redoStack.pop()
    if (entry) this.undoStack.push(entry)
    return entry?.after
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
