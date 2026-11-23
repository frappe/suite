// Shared shapes for the drag-fill pattern detectors (see index.ts).

/** A detected series: extends the source in either direction. */
export interface Series {
  kind: 'numeric' | 'date' | 'time' | 'named-sequence' | 'text-number' | 'alphabetic'
  confidence: number
  /** Detector-specific detail (the step, the sequence name); debugging only. */
  _meta?: unknown
  /**
   * The value `offset` cells past the source (1 = the next cell), extending
   * forward (`dir` +1) or backward (-1). Numbers only from the numeric
   * detector; every other detector returns text.
   */
  next(offset: number, dir?: number): string | number
}

/** Takes the source cells' raw text; null when it doesn't recognise them. */
export interface Detector {
  detect(values: readonly string[]): Series | null
}
