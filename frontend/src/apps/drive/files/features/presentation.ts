import type { LocationQuery, Router } from 'vue-router'

export type FilesViewMode = 'list' | 'grid'
export type FilesSort = 'title' | 'owner' | 'modified' | 'kind' | 'size'
export type FilesDirection = 'asc' | 'desc'
export type FilesGroup = 'none' | 'type' | 'owner' | 'modified'

export interface PresentationState {
  view: FilesViewMode
  sort: FilesSort
  dir: FilesDirection
  group: FilesGroup
  columns: string[]
}

export const DEFAULT_PRESENTATION: PresentationState = {
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
): PresentationState {
  const saved = { ...DEFAULT_PRESENTATION, ...(preference ?? {}) }
  return {
    view: oneOf(query.view, ['list', 'grid']) ?? saved.view,
    sort: oneOf(query.sort, ['title', 'owner', 'modified', 'kind', 'size']) ?? saved.sort,
    dir: oneOf(query.dir, ['asc', 'desc']) ?? saved.dir,
    group: oneOf(query.group, ['none', 'type', 'owner', 'modified']) ?? saved.group,
    columns: normalizeColumns(saved.columns),
  }
}

export async function replacePresentation(
  router: Router,
  state: PresentationState,
  change: Partial<Pick<PresentationState, 'view' | 'sort' | 'dir' | 'group'>>,
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

export function writePresentationPreference(value: PresentationState): void {
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
  return value.filter((column): column is string => ['owner', 'modified', 'kind', 'size'].includes(column))
}

