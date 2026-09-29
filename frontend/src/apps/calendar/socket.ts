import { onScopeDispose } from 'vue'
import type { Socket } from 'socket.io-client'

import { createSiteSocket } from '@/realtime'

let socket: Socket | null = null
let holders = 0

/**
 * Calendar's one site socket, shared by the Calendar layout and the Calendar
 * settings tabs. Call it in a component setup. The socket closes when the last
 * component that holds it unmounts.
 */
export function useCalendarSocket(): Socket {
	socket ??= createSiteSocket()
	holders += 1
	onScopeDispose(() => {
		holders -= 1
		if (holders > 0) return
		socket?.disconnect()
		socket = null
	})
	return socket
}
