// A version being restored holds the document still: no tab edits until the restore lands, is
// called off, or its deadline passes, whichever this tab hears of first
export class RestoreFence {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly changed: () => void) {}

  get standing() {
    return this.timer !== null
  }

  // How long the server says the fence still stands; anything but a positive number means it doesn't
  follow(ms: unknown) {
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
      this.hold(ms)
    } else {
      this.lift()
    }
  }

  lift() {
    if (!this.standing) return

    this.clear()
    this.changed()
  }

  close() {
    this.clear()
  }

  private hold(ms: number) {
    const wasStanding = this.standing
    this.clear()
    const lapse = () => {
      this.timer = null
      this.changed()
    }

    this.timer = setTimeout(lapse, ms)
    if (!wasStanding) {
      this.changed()
    }
  }

  private clear() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
