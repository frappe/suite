import type { HistoryState } from 'vue-router'

const OPENING_LOCATION = 'driveLocation'

/**
 * History state that names the folder a file's preview header will show. The
 * opening header shows it too, so the title does not move when the preview
 * loads. Back, forward and a reload keep it, as they keep the opening title.
 */
export function openingLocationState(label: string | null | undefined): HistoryState {
  return label ? { [OPENING_LOCATION]: label } : {}
}

/** The folder name an entry's opener gave it through `openingLocationState`, or `null`. */
export function openingLocation(state: HistoryState): string | null {
  const label = state[OPENING_LOCATION]
  return typeof label === 'string' && label ? label : null
}
