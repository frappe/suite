import { computed, watch, type Ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'

const READ = 10
const COMMENT = 20
const EDIT = 40

export interface SlidesAccess {
  /** False once Drive refuses READ: the surface unmounts the deck. */
  readonly readable: Readonly<Ref<boolean>>
  /** True while the presentation is Active and the caller may comment. */
  readonly canComment: Readonly<Ref<boolean>>
  /** True while the presentation is Active and the role is EDIT or more. */
  readonly writable: Readonly<Ref<boolean>>
}

export interface AccessChanges {
  /** Runs once each time edit access is lost, before the editor can queue another write. */
  narrowed?: () => void
  /** Runs once each time edit access comes back after a loss. */
  widened?: () => void
}

/** The access a Slides surface acts on: Drive's grant. */
export function createSlidesAccess(
  session: Pick<DocumentSession, 'state' | 'access'>,
  { narrowed, widened }: AccessChanges,
): SlidesAccess {
  const role = computed(() => session.access.value.role ?? 0)
  const active = computed(() => session.state.value === 'Active')
  const readable = computed(() => session.state.value !== 'Refused' && role.value >= READ)
  const canComment = computed(() => active.value && role.value >= COMMENT)
  const writable = computed(() => active.value && role.value >= EDIT)

  watch(writable, (open) => (open ? widened?.() : narrowed?.()), { flush: 'sync' })

  return {
    readable,
    canComment,
    writable,
  }
}
