import type { LocationQuery, Router } from 'vue-router'

export type FilesViewMode = 'list' | 'grid'
export type FilesSort = 'title' | 'owner' | 'modified' | 'kind' | 'size'
export type FilesDirection = 'asc' | 'desc'
/** The optional list columns, in the order the list shows them. Name is always shown. */
export const FILES_COLUMNS = ['owner', 'modified', 'kind', 'size'] as const
export type FilesColumn = (typeof FILES_COLUMNS)[number]
/** The date the date column shows. Recent shows when the user opened each file. */
export type FilesDateColumn = 'modified' | 'opened'

/** How the listing shows its rows: what the user chose, and what folder links and the saved preference carry. */
export interface PresentationState {
  view: FilesViewMode
  sort: FilesSort
  dir: FilesDirection
  columns: string[]
}

/** A change the View settings menu or a sortable header asks for. Columns change on their own. */
export type PresentationChange = Partial<Pick<PresentationState, 'view' | 'sort' | 'dir'>>

export const DEFAULT_PRESENTATION: PresentationState = {
  view: 'list',
  sort: 'title',
  dir: 'asc',
  columns: ['owner', 'modified'],
}

const KEY = 'suite-drive-files-presentation-v1'

export function resolvePresentation(
  query: LocationQuery,
  preference: Partial<PresentationState> | null = readPresentationPreference(),
  /** Narrow screens open in grid: a rem-sized table does not fit a phone. */
  viewOverride: FilesViewMode | null = null,
): PresentationState {
  const saved = { ...DEFAULT_PRESENTATION, ...(preference ?? {}) }
  return {
    view: oneOf(query.view, ['list', 'grid']) ?? viewOverride ?? saved.view,
    sort: oneOf(query.sort, ['title', 'owner', 'modified', 'kind', 'size']) ?? saved.sort,
    dir: oneOf(query.dir, ['asc', 'desc']) ?? saved.dir,
    columns: normalizeColumns(saved.columns),
  }
}

export async function replacePresentation(
  router: Router,
  state: PresentationState,
  change: PresentationChange,
): Promise<void> {
  const next = { ...state, ...change }
  writePresentationPreference(next)
  await router.replace({
    query: {
      ...router.currentRoute.value.query,
      view: next.view,
      sort: next.sort,
      dir: next.dir,
    },
  })
}

export function writePresentationPreference({ view, sort, dir, columns }: PresentationState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify({ view, sort, dir, columns }))
  } catch {
    // Storage blocked or full (private windows): the choice still applies through the URL.
  }
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

