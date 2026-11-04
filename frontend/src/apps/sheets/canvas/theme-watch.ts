/**
 * Calls `onChange` when the page's theme (`data-theme` on <html>) changes.
 * The grid reads its colours from the theme's CSS tokens at paint time, so it
 * only needs a repaint. A write of the same theme is ignored: the theme module
 * re-applies the theme on every save. Returns a function that stops watching.
 */
export function watchTheme(
  onChange: () => void,
  root: HTMLElement = document.documentElement,
): () => void {
  let theme = root.getAttribute('data-theme')
  const observer = new MutationObserver(() => {
    const next = root.getAttribute('data-theme')
    if (next === theme) return
    theme = next
    onChange()
  })
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}
