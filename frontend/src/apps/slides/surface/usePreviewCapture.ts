/**
 * The deck's Drive preview: a picture of the first slide (drive-layer spec §9.2).
 *
 * A few seconds after the last save lands, or after a version restore has
 * reloaded the deck, the tab that writes the deck draws the first slide and
 * sends it to Drive's preview route. Drive stores it without stamping the deck,
 * so a capture is not an edit. A view-only tab sends nothing. A reload
 * that fails cancels the capture, as the slides may no longer be what the deck holds.
 *
 * The first capture of a session is sent even if the first slide did not change,
 * because that is how an older deck gets a preview. After that, a first slide
 * that is as it was last sent sends nothing. Opening a deck sends nothing.
 */
import { onScopeDispose, type ShallowRef } from 'vue'

import { api, client } from '@/api'
import { inReadonlyMode } from '@/apps/slides/stores/presentation'
import { slides } from '@/apps/slides/stores/slide'
import type { RequestContext } from '@/platform/transport'

/** Saves come every second while someone types, so the capture waits for a pause. */
const PREVIEW_DELAY_MS = 5_000
export const PREVIEW_WIDTH = 960
export const PREVIEW_HEIGHT = 540
// Images and fonts that have not arrived by then are drawn without.
const DRAW_TIMEOUT_MS = 5_000
// A browser that cannot encode WebP answers PNG, which Drive also accepts.
const IMAGE_DATA_URL = /^data:(image\/[\w.+-]+);base64,(.+)$/

interface PreviewCaptureOptions {
  node: string
  context?: RequestContext
  /** The first slide, drawn at full size where nobody sees it. */
  target: Readonly<ShallowRef<HTMLElement | null>>
}

/** Keep the node's preview in step with the first slide. Call it in a component's setup. */
export function usePreviewCapture(options: PreviewCaptureOptions) {
  let sentSlide: string | null = null
  let capturing = false
  let timer: number | undefined
  let cancels = 0

  const writes = () => !inReadonlyMode.value

  /** The tab may not be writing yet or any more, so `capture` checks when the pause ends. */
  function captureAfterPause() {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void capture(), PREVIEW_DELAY_MS)
  }

  /** The deck may no longer hold what the slides show, so nothing waiting or being drawn is sent. */
  function cancelCapture() {
    window.clearTimeout(timer)
    cancels++
  }

  onScopeDispose(() => window.clearTimeout(timer))

  async function capture() {
    const slide = firstSlide()
    const element = options.target.value
    if (capturing || !slide || slide === sentSlide || !element?.isConnected || !writes()) return
    capturing = true
    const cancelsAtStart = cancels
    try {
      const picture = IMAGE_DATA_URL.exec(await draw(element))
      if (!picture || !writes() || cancels !== cancelsAtStart) return
      const [, mime, image] = picture
      await client.mutation(
        api.drive.nodes.setPreview,
        { node: options.node, image, mime },
        { context: options.context, silent: true },
      )
      sentSlide = slide
    } catch (error) {
      // The next save that lands tries again.
      console.warn('Could not update the presentation preview', error)
    } finally {
      capturing = false
    }
  }

  return { captureAfterPause, cancelCapture }
}

function firstSlide(): string | null {
  const slide = slides.value[0]
  return slide ? JSON.stringify({ background: slide.background, elements: slide.elements }) : null
}

// Loaded here, so a link guest, a phone viewer or a locked tab never fetches the library.
async function draw(element: HTMLElement): Promise<string> {
  const { domToWebp } = await import('modern-screenshot')
  return domToWebp(element, {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    scale: 1,
    backgroundColor: '#ffffff',
    quality: 0.86,
    timeout: DRAW_TIMEOUT_MS,
  })
}
