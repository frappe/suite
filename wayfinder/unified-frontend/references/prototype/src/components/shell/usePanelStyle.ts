// Two candidates for how an app's own sidebar meets the content beside it,
// switchable from the URL so both can be opened in two windows and compared
// side by side rather than from memory:
//
//   ?panel=stroke  base fill, hairline on the right   (default)
//   ?panel=fill    surface-gray-1, no hairline, like the app rail
//
// Read once at startup and held in a module ref, because in-app navigation
// pushes route params without the query — and a comparison that resets the
// moment you switch from Mail to Calendar is no comparison at all.
import { ref } from 'vue'

export type PanelStyle = 'stroke' | 'fill'

function fromUrl(): PanelStyle {
  // Hash-mode routing keeps the query inside the hash, so location.search is
  // empty here: the part after the hash's own '?' is the one that matters.
  const hash = window.location.hash
  const mark = hash.indexOf('?')
  const query = mark === -1 ? '' : hash.slice(mark + 1)
  return new URLSearchParams(query).get('panel') === 'fill' ? 'fill' : 'stroke'
}

export const panelStyle = ref<PanelStyle>(fromUrl())
