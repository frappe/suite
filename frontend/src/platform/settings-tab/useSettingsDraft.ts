import { computed, ref, watch, type Ref } from 'vue'

// Drafts hold form values, which are JSON data: strings, numbers, flags and lists of them.
// SAFETY: a JSON round trip of JSON data gives back a value of the same shape.
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The draft of a `SettingsForm` or a settings dialog with a Save button: the fields as the person
 * edits them, and whether they differ from what is stored.
 *
 * `stored` gives the saved values in the draft's shape, or nothing while they load (or while a
 * dialog is closed). `dirty` is true while the draft differs from them, and false again once the
 * draft is put back. When the stored values change, the draft follows them only if it was not
 * dirty, or already matches them: a refresh of server data, after a photo upload for example,
 * does not overwrite what the person has typed. `reset` puts the stored values in the draft, for a
 * save whose server copy differs from what was typed.
 */
export function useSettingsDraft<T extends object>(stored: () => T | null | undefined) {
  // SAFETY: `ref<T>()` unwraps T in its type; the draft holds plain JSON values.
  const draft = ref<T>() as Ref<T | undefined>
  const dirty = computed(() => {
    const saved = stored()
    return !!draft.value && !!saved && !same(draft.value, saved)
  })

  watch(
    stored,
    (next, previous) => {
      if (!next) return
      const current = draft.value
      if (!current || !previous || same(current, previous) || same(current, next))
        draft.value = copy(next)
    },
    { immediate: true },
  )

  function reset() {
    const saved = stored()
    if (saved) draft.value = copy(saved)
  }

  return { draft, dirty, reset }
}
