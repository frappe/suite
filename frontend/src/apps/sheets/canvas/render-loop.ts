// Frame scheduling for the grid.
//
// scheduleRender() coalesces any number of requests into one paint on the
// next animation frame. render() paints immediately. Listeners registered
// with onRender() run after every paint, so DOM overlays (filter chevrons,
// the fill-handle FAB, remote cursors) re-position against the new layout.
//
// What a paint draws is not this module's concern: the caller passes it in.

export interface FrameScheduler {
  request(cb: () => void): number
  cancel(handle: number): void
}

const browserFrames: FrameScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (handle) => cancelAnimationFrame(handle),
}

export interface RenderLoop {
  /** Paint now, then notify listeners. */
  render(): void
  /** Paint once on the next frame, however often this is called before it. */
  scheduleRender(): void
  /** Runs after every paint. Returns an unsubscribe function. */
  onRender(cb: () => void): () => void
  /** Drops a pending frame; later calls still work. */
  cancel(): void
}

export function createRenderLoop(
  paint: () => void,
  frames: FrameScheduler = browserFrames,
): RenderLoop {
  let pending: number | null = null
  const listeners: (() => void)[] = []

  function render(): void {
    paint()
    for (const cb of listeners) cb()
  }

  function scheduleRender(): void {
    if (pending !== null) return
    pending = frames.request(() => {
      pending = null
      render()
    })
  }

  function onRender(cb: () => void): () => void {
    listeners.push(cb)
    return () => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    }
  }

  function cancel(): void {
    if (pending === null) return
    frames.cancel(pending)
    pending = null
  }

  return { render, scheduleRender, onRender, cancel }
}
