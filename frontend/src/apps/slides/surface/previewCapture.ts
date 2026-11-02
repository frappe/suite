/**
 * The deck's Drive preview: a picture of the first slide (drive-layer spec §9.2).
 *
 * A few seconds after the last save lands, the tab that writes the deck draws
 * the first slide and sends it to Drive's preview route. Drive stores it
 * without stamping the deck, so a capture is not an edit. A tab that does not
 * write the deck sends nothing: view only, open for editing in another tab, or
 * refused by the server. A save that leaves the first slide as it was last
 * sent sends nothing either.
 */
import { domToWebp } from 'modern-screenshot'
import { onScopeDispose, toValue, watch, type MaybeRefOrGetter } from 'vue'

import { api, client } from '@/api'
import { inReadonlyMode } from '@/apps/slides/stores/presentation'
import { dirty, isSaving, saveFailed } from '@/apps/slides/stores/saving'
import { slides } from '@/apps/slides/stores/slide'
import type { RequestContext } from '@/platform/transport'

/** Saves come every second while someone types, so the capture waits for a pause. */
export const PREVIEW_DELAY_MS = 5_000
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
  target: MaybeRefOrGetter<HTMLElement | null>
}

/** Keep the node's preview in step with the first slide. Call it in a component's setup. */
export function usePreviewCapture(options: PreviewCaptureOptions): void {
  let sentSlide: string | null = null
  let capturing = false
  let timer: number | undefined

  const writes = () => !inReadonlyMode.value && !saveFailed.value
  const settled = () => writes() && !dirty.value && !isSaving.value

  watch(isSaving, (saving, wasSaving) => {
    if (saving || !wasSaving || !settled()) return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void capture(), PREVIEW_DELAY_MS)
  })
  onScopeDispose(() => window.clearTimeout(timer))

  async function capture() {
    const slide = firstSlide()
    const element = toValue(options.target)
    if (capturing || !slide || slide === sentSlide || !element?.isConnected || !settled()) return
    capturing = true
    try {
      const picture = IMAGE_DATA_URL.exec(await draw(element))
      if (!picture || !writes()) return
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
}

function firstSlide(): string | null {
  const slide = slides.value[0]
  return slide ? JSON.stringify({ background: slide.background, elements: slide.elements }) : null
}

function draw(element: HTMLElement): Promise<string> {
  return domToWebp(element, {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    scale: 1,
    backgroundColor: '#ffffff',
    quality: 0.86,
    timeout: DRAW_TIMEOUT_MS,
  })
}
