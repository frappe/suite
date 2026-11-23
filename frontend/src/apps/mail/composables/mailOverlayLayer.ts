import { providePortalTarget } from 'frappe-ui'
import { onScopeDispose } from 'vue'

// The rules the layer is for, loaded with it wherever it is used.
import '@/apps/mail/styles.css'

/**
 * Mail's overlay layer, for everything below the calling component. frappe-ui overlays (Dialogs,
 * Dropdowns, Popovers, BottomSheets) and Mail's own full-screen panes teleport here instead of to
 * bare <body>, so Mail's styles (styles.css) reach them through `.mail-app` without a class on
 * <body>. Nothing Mail styles then reaches the document, the shell, or another area. The layer is
 * a plain block at the end of <body>: it makes no stacking context, so the overlays stack as they
 * did on <body>. It exists from the caller's setup on, before any child mounts a Teleport, and
 * leaves with the caller. Call it in a component's setup.
 */
export function provideMailOverlayLayer(): void {
  const overlayLayer = document.createElement('div')
  overlayLayer.className = 'mail-app'
  document.body.append(overlayLayer)
  providePortalTarget(overlayLayer)
  onScopeDispose(() => overlayLayer.remove())
}
