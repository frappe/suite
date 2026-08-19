// PROTOTYPE — remove. The one piece of state the Calendar sidebar and the
// Calendar screen both need.
//
// frappe-ui's Calendar owns its date internally and takes no date prop, so the
// two talk through these module refs instead:
//   - the sidebar calls `goToDate`; the screen watches `jumpTo` and jumps
//   - the screen writes `visibleRange`; the sidebar follows and shades it
// Writing only one direction each keeps the two out of a feedback loop.
import { ref } from 'vue'
import dayjs from 'dayjs'

const today = dayjs().format('YYYY-MM-DD')

/**
 * Date the sidebar asked the main view to show. `seq` rises on every request,
 * so asking twice for the same date still moves the view.
 */
export const jumpTo = ref({ date: today, seq: 0 })

/** Range the main view currently shows, inclusive. */
export const visibleRange = ref({ start: today, end: today })

export function goToDate(date: string) {
  jumpTo.value = { date, seq: jumpTo.value.seq + 1 }
}
