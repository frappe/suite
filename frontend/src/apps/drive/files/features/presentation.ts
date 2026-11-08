import type { LocationQuery, Router } from 'vue-router'

export type FilesViewMode = 'list' | 'grid'
export type FilesSort = 'title' | 'owner' | 'modified' | 'kind' | 'size'
export type FilesDirection = 'asc' | 'desc'
/** The optional list columns, in the order View settings offers them. Name is always shown. */
export const FILES_COLUMNS = ['access', 'owner', 'modified', 'kind', 'size'] as const
export type FilesColumn = (typeof FILES_COLUMNS)[number]
/** The date the date column shows. Recent shows when the user opened each file. */
export type FilesDateColumn = 'modified' | 'opened'

/** How the listing shows its rows: what the user chose, and what folder links and the saved preference carry. */
export interface PresentationState {
  view: FilesViewMode
  sort: FilesSort
  dir: FilesDirection
  columns: FilesColumn[]
}

/** The saved preference: the presentation, and the columns the user switched themselves. */
export interface PresentationPreference extends PresentationState {
  /** The columns the user turned on or off. The others follow their defaults. */
  toggled: string[]
}

/** A change the View settings menu or a sortable header asks for. Columns change on their own. */
export type PresentationChange = Partial<Pick<PresentationState, 'view' | 'sort' | 'dir'>>

export const DEFAULT_PRESENTATION: PresentationState = {
  view: 'list',
  sort: 'title',
  dir: 'asc',
  columns: [...FILES_COLUMNS],
}

/** The columns a preference saved before `toggled` existed listed when the user had not chosen any. */
const LEGACY_DEFAULT_COLUMNS: readonly FilesColumn[] = ['owner', 'modified']

/** The order a field starts in when it is chosen: dates newest first, sizes largest first. */
export const DEFAULT_DIRECTION: Record<FilesSort, FilesDirection> = {
  title: 'asc',
  kind: 'asc',
  owner: 'asc',
  modified: 'desc',
  size: 'desc',
}

/** The sort a header click asks for: a new field starts in its default order, the same field flips. */
export function nextSort(
  current: Pick<PresentationState, 'sort' | 'dir'>,
  column: FilesSort,
): Pick<PresentationState, 'sort' | 'dir'> {
  if (current.sort !== column) return { sort: column, dir: DEFAULT_DIRECTION[column] }
  return { sort: column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}

const KEY = 'suite-drive-files-presentation-v1'

export function resolvePresentation(
  query: LocationQuery,
  preference: Partial<PresentationPreference> | null = readPresentationPreference(),
  /** Narrow screens open in grid: a rem-sized table does not fit a phone. */
  viewOverride: FilesViewMode | null = null,
): PresentationState {
  const saved = { ...DEFAULT_PRESENTATION, ...(preference ?? {}) }
  return {
    view: oneOf(query.view, ['list', 'grid']) ?? viewOverride ?? saved.view,
    sort: oneOf(query.sort, ['title', 'owner', 'modified', 'kind', 'size']) ?? saved.sort,
    dir: oneOf(query.dir, ['asc', 'desc']) ?? saved.dir,
    columns: resolveColumns(saved),
  }
}

/**
 * The columns the list shows. Every column is on by default, and a column the
 * user never switched follows that default, so a column added later, such as
 * Access, shows without resetting their choices.
 */
function resolveColumns(saved: Partial<PresentationPreference>): FilesColumn[] {
  const chosen = normalizeColumns(saved.columns)
  const toggled = toggledColumns(saved)
  return FILES_COLUMNS.filter((column) => !toggled.includes(column) || chosen.includes(column))
}

/**
 * The columns the user switched. A preference saved before `toggled` existed
 * and listing other than the old default columns means the user chose them all.
 */
function toggledColumns(saved: Partial<PresentationPreference>): string[] {
  if (Array.isArray(saved.toggled)) return saved.toggled
  const listed = normalizeColumns(saved.columns)
  const isOldDefault =
    listed.length === LEGACY_DEFAULT_COLUMNS.length &&
    LEGACY_DEFAULT_COLUMNS.every((column) => listed.includes(column))
  return isOldDefault ? [] : ['owner', 'modified', 'kind', 'size']
}

/** Saves the user's choice to show or hide one column. `shown` is what the list shows now. */
export function writeColumnChoice(
  shown: readonly FilesColumn[],
  column: FilesColumn,
  visible: boolean,
): void {
  const toggled = toggledColumns(readPresentationPreference() ?? {})
  writePresentationPreference({
    columns: visible ? [...new Set([...shown, column])] : shown.filter((item) => item !== column),
    toggled: [...new Set([...toggled, column])],
  })
}

export async function replacePresentation(
  router: Router,
  state: PresentationState,
  change: PresentationChange,
): Promise<void> {
  const next = { ...state, ...change }
  // Columns stay as saved, so a column the user never chose keeps following its default.
  writePresentationPreference({ view: next.view, sort: next.sort, dir: next.dir })
  await router.replace({
    query: {
      ...router.currentRoute.value.query,
      view: next.view,
      sort: next.sort,
      dir: next.dir,
    },
  })
}

/** Saves `change` over the saved preference. */
export function writePresentationPreference(change: Partial<PresentationPreference>): void {
  if (typeof localStorage === 'undefined') return
  try {
    const { view, sort, dir, columns, toggled } = { ...readPresentationPreference(), ...change }
    localStorage.setItem(KEY, JSON.stringify({ view, sort, dir, columns, toggled }))
  } catch {
    // Storage blocked or full (private windows): the choice still applies through the URL.
  }
}

export function readPresentationPreference(): Partial<PresentationPreference> | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const item = Array.isArray(value) ? value[0] : value
  return allowed.find((candidate) => candidate === item) ?? null
}

function normalizeColumns(value: unknown): FilesColumn[] {
  if (!Array.isArray(value)) return [...LEGACY_DEFAULT_COLUMNS]
  return value.filter((column): column is FilesColumn =>
    FILES_COLUMNS.some((candidate) => candidate === column),
  )
}
