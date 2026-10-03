import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { Session } from '@/platform/session'

import type { LinkStore } from './links'

/** The longest `author_name` the server accepts, in code points (Drive §6.7). */
export const GUEST_NAME_LIMIT = 140

/** The "Your name" field of a comment composer (spec §10.5). */
export interface GuestCommentName {
  /** Only a visitor without a session sees the field. */
  readonly shown: ComputedRef<boolean>
  /** The field's text, prefilled with the name this browser sent last. */
  readonly text: Ref<string>
  /** The text is at the limit. The composer says so, so nothing is cut silently. */
  readonly atLimit: ComputedRef<boolean>
  /**
   * The field's `maxlength`. The browser counts UTF-16 units and the server
   * counts code points, so each character outside the Basic Multilingual Plane,
   * such as an emoji, adds one unit.
   */
  readonly maxLength: ComputedRef<number>
  /**
   * The `author_name` for one comment, trimmed. It keeps the name for the next
   * visit. `undefined` while signed in or when the field is empty: the comment
   * then shows the server's plain "Guest".
   */
  take(): string | undefined
}

export function createGuestCommentName(
  store: Pick<LinkStore, 'guestName' | 'setGuestName'>,
  session: Pick<Session, 'status'>,
): GuestCommentName {
  const shown = computed(() => session.status.value === 'guest')
  const text = ref(store.guestName() ?? '')
  const codePoints = computed(() => [...text.value].length)
  return {
    shown,
    text,
    atLimit: computed(() => codePoints.value >= GUEST_NAME_LIMIT),
    maxLength: computed(() => text.value.length + Math.max(0, GUEST_NAME_LIMIT - codePoints.value)),
    take() {
      if (!shown.value) return undefined
      const name = text.value.trim()
      text.value = name
      store.setGuestName(name)
      return name || undefined
    },
  }
}
