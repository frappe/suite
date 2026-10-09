// Types for sparkline.js, so strict TypeScript can import it.

export type SparkType = 'line' | 'column'

/** What `=SPARKLINE(...)` evaluates to; the cell paints a chart from it. */
export interface SparkSpec {
  __spark: true
  type: SparkType
  data: number[]
  color: string | null
}

export type SparkGeometry =
  | { kind: 'line'; points: { x: number; y: number }[] }
  | { kind: 'bars'; bars: { x: number; y: number; w: number; h: number; neg: boolean }[] }

export function sparkType(v: unknown): SparkType
export function sparkSpec(
  data: readonly unknown[] | null | undefined,
  type: unknown,
  color: unknown,
): SparkSpec
export function isSparkSpec(v: unknown): v is SparkSpec
/** Drawing primitives inside a w × h box, or null when there's nothing to draw. */
export function sparkGeometry(
  spec: SparkSpec | null | undefined,
  w: number,
  h: number,
  pad?: number,
): SparkGeometry | null

export interface SparklineRef {
  /** null: the sparkline cell's own sheet. */
  sheet: string | null
  r0: number
  c0: number
  r1: number
  c1: number
  type: string | null
  color: string | null
}
/** The range and options of a `=SPARKLINE(...)` input, or null. */
export function parseSparkline(input: unknown): SparklineRef | null
