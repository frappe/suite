import { effectScope } from 'vue'
import { describe, expect, it, vi } from 'vitest'

// Every socket the site opens is a fake, so the test sees which one Calendar holds.
vi.mock('socket.io-client', () => ({
	io: () => ({ on: vi.fn(), disconnect: vi.fn() }),
}))

// The site socket URL reads these from the boot page.
Object.assign(window, { site_name: 'slides.localhost', socketio_port: '9000' })

const { useCalendarSocket } = await import('@/apps/calendar/socket')

describe('Calendar socket', () => {
	it('shares one socket between holders and closes it when the last one unmounts', () => {
		const layout = effectScope()
		const settingsTab = effectScope()
		const fromLayout = layout.run(useCalendarSocket)!
		const fromTab = settingsTab.run(useCalendarSocket)!

		expect(fromTab).toBe(fromLayout)

		settingsTab.stop()
		expect(fromLayout.disconnect).not.toHaveBeenCalled()
		layout.stop()
		expect(fromLayout.disconnect).toHaveBeenCalledOnce()

		// The next mount opens a fresh socket.
		const again = effectScope()
		expect(again.run(useCalendarSocket)).not.toBe(fromLayout)
		again.stop()
	})
})
