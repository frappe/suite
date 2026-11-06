import { translate as __ } from '@/platform/translation'

/** How fast the average forgets: a sample's weight falls with exp(-age / 10 s). */
const FADE_MS = 10_000
/** No estimate before this much uploading, and at least two samples. */
const SETTLE_MS = 5_000
/** No bytes for this long hides the estimate. */
const STALL_MS = 30_000
/** The shown text changes at most this often. */
const STEADY_MS = 5_000

export interface UploadSample {
  /** Bytes sent across the run, done files included. */
  sent: number
  /** Bytes the run will send. */
  total: number
  at: number
}

/**
 * Time left for a run of uploads (t30-time-left): an exponential moving
 * average of the upload rate, fed the run's totals as they change. `update`
 * returns the text to show, or `null` while there is no fair estimate.
 */
export class TimeLeft {
  private rate: number | null = null
  private samples = 0
  private startedAt: number | null = null
  private last: UploadSample | null = null
  private movedAt = 0
  private shown: { text: string; at: number } | null = null

  constructor(private readonly locale?: string) {}

  update(sample: UploadSample): string | null {
    const last = this.last
    this.last = sample
    if (!last || this.startedAt === null) {
      this.startedAt = sample.at
      this.movedAt = sample.at
      return this.show(null, sample.at)
    }
    const moved = sample.sent - last.sent
    // Bytes arrive in steps, such as one chunk at a time, so a step counts
    // over the time since the one before. Files joining the run bring bytes
    // already sent; they are not speed.
    if (moved > 0 && sample.total === last.total) this.addRate(moved, sample.at - this.movedAt)
    if (moved > 0) this.movedAt = sample.at
    if (
      this.rate === null ||
      this.samples < 2 ||
      sample.at - this.startedAt < SETTLE_MS ||
      sample.at - this.movedAt >= STALL_MS
    )
      return this.show(null, sample.at)
    const seconds = Math.max(sample.total - sample.sent, 0) / this.rate
    return this.show(formatTimeLeft(seconds, this.locale), sample.at)
  }

  /** Forgets the average, as after a pause or a reconnect. */
  reset() {
    this.rate = null
    this.samples = 0
    this.startedAt = null
    this.last = null
    this.shown = null
  }

  private addRate(bytes: number, ms: number) {
    if (ms <= 0) return
    const rate = (bytes / ms) * 1000
    const weight = 1 - Math.exp(-ms / FADE_MS)
    this.rate = this.rate === null ? rate : this.rate + weight * (rate - this.rate)
    this.samples += 1
  }

  private show(text: string | null, at: number): string | null {
    if (text === null) {
      this.shown = null
      return null
    }
    if (!this.shown || (this.shown.text !== text && at - this.shown.at >= STEADY_MS))
      this.shown = { text, at }
    return this.shown.text
  }
}

/** "Less than a minute left", "About 3 minutes left", "About 2 hours left". */
export function formatTimeLeft(seconds: number, locale?: string): string {
  const minutes = Math.round(seconds / 60)
  if (seconds < 60) return __('Less than a minute left')
  if (minutes < 60) return __('About {0} left', [inUnit(minutes, 'minute', locale)])
  return __('About {0} left', [inUnit(Math.round(seconds / 3600), 'hour', locale)])
}

function inUnit(value: number, unit: 'minute' | 'hour', locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(value)
}
