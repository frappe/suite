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

const OPENING_FILE = 'driveFile'

/** History state that says the entry opens a file's preview, which keeps the rail while it opens. */
export function openingFileState(): HistoryState {
  return { [OPENING_FILE]: true }
}

/** Whether an entry's opener marked it a file's preview through `openingFileState`. */
export function opensFile(state: HistoryState): boolean {
  return state[OPENING_FILE] === true
}
