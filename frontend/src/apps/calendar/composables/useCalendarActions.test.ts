import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import { useCalendarActions } from './useCalendarActions'

import type { CalendarRow } from '@/apps/calendar/utils/calendars'

vi.mock('frappe-ui', () => ({
	createResource: () => reactive({ data: undefined, loading: false, submit: vi.fn(), fetch: vi.fn() }),
}))

beforeEach(() => {
	setActivePinia(createPinia())
	;(globalThis as any).__ = (text: string) => text
})

const calendar = (extra: Partial<CalendarRow> = {}): CalendarRow => ({
	name: 'te|a1',
	account: 'te',
	id: 'a1',
	_name: 'Personal',
	default: 0,
	visible: 1,
	may_write_all: 1,
	may_delete: 1,
	may_share: 1,
	...extra,
})

/** The labels a calendar's menu actually offers, the conditions applied. */
const offered = (row: CalendarRow) => {
	const { menuOptions } = useCalendarActions()
	return menuOptions(row)
		.filter((option) => !option.condition || option.condition())
		.map((option) => option.label)
}

describe('useCalendarActions', () => {
	// Building the menu reaches every option's icon. An icon that is named but never imported
	// is a ReferenceError here and a blank sidebar in the app, which nothing else here catches.
	it('builds a calendar menu without reaching for anything it does not have', () => {
		expect(() => useCalendarActions().menuOptions(calendar())).not.toThrow()
	})

	it('offers sharing where the mail server says the calendar may be shared', () => {
		expect(offered(calendar({ may_share: 1 }))).toContain('Share')
	})

	it('does not offer sharing where the server withholds the right', () => {
		expect(offered(calendar({ may_share: 0 }))).not.toContain('Share')
	})

	it('offers sharing on a calendar shared read-only where the server allows it', () => {
		// Sharing follows the right the server reports, not whether the calendar is editable.
		const options = offered(calendar({ may_write_all: 0, may_share: 1 }))
		expect(options).toContain('Share')
		expect(options).not.toContain('Edit')
	})
})
