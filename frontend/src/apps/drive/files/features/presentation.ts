import type { LocationQuery, Router } from 'vue-router'

export type FilesViewMode = 'list' | 'grid'
export type FilesSort = 'title' | 'owner' | 'modified' | 'kind' | 'size'
export type FilesDirection = 'asc' | 'desc'
const CHOSEN_GROUPS = ['none', 'type', 'owner', 'modified'] as const
/** A grouping the user can pick, from the menu, the URL or their saved preference. */
export type FilesChosenGroup = (typeof CHOSEN_GROUPS)[number]
/** `opened` is Recent's own grouping, by visit day. Only the page shows it. */
export type FilesGroup = FilesChosenGroup | 'opened'
/** The optional list columns, in the order the list shows them. Name is always shown. */
export const FILES_COLUMNS = ['owner', 'modified', 'kind', 'size'] as const
export type FilesColumn = (typeof FILES_COLUMNS)[number]

/** How the listing shows its rows. */
export interface PresentationState {
  view: FilesViewMode
  sort: FilesSort
  dir: FilesDirection
  group: FilesGroup
  columns: string[]
}

/** What the user chose, and what folder links and the saved preference carry. */
export interface ChosenPresentation extends PresentationState {
  group: FilesChosenGroup
}

export const DEFAULT_PRESENTATION: ChosenPresentation = {
  view: 'list',
  sort: 'title',
  dir: 'asc',
  group: 'none',
  columns: ['owner', 'modified'],
}

const KEY = 'suite-drive-files-presentation-v1'

export function resolvePresentation(
  query: LocationQuery,
  preference: Partial<PresentationState> | null = readPresentationPreference(),
  /** Narrow screens open in grid: a rem-sized table does not fit a phone. */
  viewOverride: FilesViewMode | null = null,
): ChosenPresentation {
  const saved = { ...DEFAULT_PRESENTATION, ...(preference ?? {}) }
  return {
    view: oneOf(query.view, ['list', 'grid']) ?? viewOverride ?? saved.view,
    sort: oneOf(query.sort, ['title', 'owner', 'modified', 'kind', 'size']) ?? saved.sort,
    dir: oneOf(query.dir, ['asc', 'desc']) ?? saved.dir,
    group: oneOf(query.group, CHOSEN_GROUPS) ?? oneOf(saved.group, CHOSEN_GROUPS) ?? DEFAULT_PRESENTATION.group,
    columns: normalizeColumns(saved.columns),
  }
}

export async function replacePresentation(
  router: Router,
  state: ChosenPresentation,
  change: Partial<Pick<ChosenPresentation, 'view' | 'sort' | 'dir' | 'group'>>,
): Promise<void> {
  const next = { ...state, ...change }
  writePresentationPreference(next)
  await router.replace({
    query: {
      ...router.currentRoute.value.query,
      view: next.view,
      sort: next.sort,
      dir: next.dir,
      group: next.group === 'none' ? undefined : next.group,
    },
  })
}

export function writePresentationPreference(value: ChosenPresentation): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(value))
}

export function readPresentationPreference(): Partial<PresentationState> | null {
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
  return typeof item === 'string' && allowed.includes(item as T) ? (item as T) : null
}

function normalizeColumns(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_PRESENTATION.columns]
  return value.filter((column): column is FilesColumn => (FILES_COLUMNS as readonly unknown[]).includes(column))
}

