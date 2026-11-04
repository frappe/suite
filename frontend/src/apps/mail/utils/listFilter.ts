import { Checkbox } from 'frappe-ui'
import { computed, h, ref } from 'vue'

/**
 * One entry of the filter menu — what the toolbar hands to Dropdown/AdaptiveDropdown. A checkbox
 * row: its box is the prefix, and `keepOpen` (with the click's own preventDefault on desktop)
 * leaves the menu up, so several can be ticked in a row.
 */
export interface FilterOption {
  /** The filter's `filter_by` key. */
  key: string
  label: string
  slots: { prefix: () => ReturnType<typeof h> }
  onClick: (event?: Event) => void
  keepOpen: true
  condition?: () => boolean
}
interface ListFilterOptions {
  /** Apply the new filter: refetch the first window. */
  onChange: () => void
  /**
   * Whether the Starred filter is offered. Off inside Trash and inside the Starred list itself,
   * where it would filter a list to itself.
   */
  starrable?: () => boolean
  /**
   * Whether "Unknown sender" is offered: in an Inbox that screens new senders, where their mail
   * waits marked until someone decides on them.
   */
  screenable?: () => boolean
}

/**
 * The list filter — Unread, Starred, Has attachments, Unknown sender — its menu, and the title the
 * toolbar shows for it. Filters combine: each one ticked narrows the list further, and none ticked is
 * all of it. Sent to the server as one `filter_by` of comma-joined keys. Not remembered: a list opens
 * unfiltered, and another list starts clear, so mail is never hidden by a filter set long ago.
 */
export const useListFilter = ({
  onChange,
  starrable = () => true,
  screenable = () => false,
}: ListFilterOptions) => {
  const stored = ref<string[]>([])
  // A filter changed on a list already showing, so the list stays up while the filtered one loads
  // inline, rather than the whole view giving way to the spinner.
  const changed = ref(false)

  // Each filter in the order the menu lists it, with whether this list offers it.
  const FILTERS = [
    { key: 'unread', label: () => __('Unread'), offered: () => true },
    { key: 'starred', label: () => __('Starred'), offered: starrable },
    { key: 'has_attachments', label: () => __('Has attachments'), offered: () => true },
    { key: 'unscreened', label: () => __('Unknown sender'), offered: screenable },
  ]

  /** The filters in effect: those ticked that this list offers, in menu order. */
  const active = computed(() => FILTERS.filter((f) => f.offered() && stored.value.includes(f.key)))

  /** What the list asks the server for: the filters in effect, comma-joined, or none. */
  const filter = computed(() => active.value.map((f) => f.key).join(',') || null)

  const toggle = (key: string) => {
    stored.value = stored.value.includes(key)
      ? stored.value.filter((k) => k !== key)
      : FILTERS.map((f) => f.key).filter((k) => k === key || stored.value.includes(k))
    changed.value = true
    onChange()
  }

  /** Take every filter off a list that is showing, which then reloads. */
  const clear = () => {
    if (!stored.value.length) return
    stored.value = []
    changed.value = true
    onChange()
  }

  /** Start clear: another list (a mailbox switch) opens unfiltered. */
  const reloadFilter = () => {
    stored.value = []
    changed.value = false
  }

  // Computed, not a constant array: each row's box has to follow what is ticked.
  const FILTER_OPTIONS = computed<FilterOption[]>(() =>
    FILTERS.map((f) => {
      const ticked = stored.value.includes(f.key)
      return {
        key: f.key,
        label: f.label(),
        slots: {
          prefix: () => h(Checkbox, { modelValue: ticked, class: 'pointer-events-none' }),
        },
        keepOpen: true as const,
        onClick: (event?: Event) => {
          event?.preventDefault()
          toggle(f.key)
        },
        condition: f.offered,
      }
    }),
  )

  /** What the toolbar's filter selector reads: the ticked filter's own label, as the menu shows
   *  it. Callers may show something else instead — a selection count, a result count. */
  const filterTitle = computed(() => {
    if (!active.value.length) return __('All mail')
    // Several at once: the first by name and a count of the rest ("Unread +1"); the menu's ticks
    // say which the rest are.
    if (active.value.length > 1)
      return __('{0} +{1}', [active.value[0].label(), String(active.value.length - 1)])
    return active.value[0].label()
  })

  return { filter, changed, reloadFilter, clear, FILTER_OPTIONS, filterTitle }
}
