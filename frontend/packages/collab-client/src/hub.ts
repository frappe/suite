import { parseJoinAnswer, type JoinAnswer } from './payloads'
import type { LiveSocket } from './types'

// Must match ROOMS_MAX in realtime/collab.js, which refuses a larger set
const ROOMS_MAX = 8

// The calls a socket's hub makes on each document open on it
export interface HubMember {
  currentKeys(): string[]
  connected(): void
  dropped(): void
  answered(answer: JoinAnswer | null, rooms: string[]): void
}

// A socket's room set belongs to every document open on it, so it is sent whole
export class Hub {
  private static hubs = new WeakMap<LiveSocket, Hub>()
  readonly members = new Set<HubMember>()
  private roomSetVersion = 0

  static forSocket(socket: LiveSocket) {
    let hub = Hub.hubs.get(socket)
    if (!hub) {
      hub = new Hub(socket)
      Hub.hubs.set(socket, hub)
    }
    return hub
  }

  private constructor(private readonly socket: LiveSocket) {
    const connected = () => {
      for (const member of this.members) {
        member.connected()
      }
      this.sendRoomSet()
    }
    const dropped = () => {
      this.roomSetVersion++
      for (const member of this.members) {
        member.dropped()
      }
    }
    socket.on('connect', connected)
    socket.on('disconnect', dropped)
  }

  sendRoomSet() {
    const keys = [...this.members].flatMap((member) => member.currentKeys())
    const rooms = [...new Set(keys)].slice(0, ROOMS_MAX)
    const version = ++this.roomSetVersion
    if (!this.socket.connected) return

    const answered = (rawAnswer: unknown) => {
      if (version !== this.roomSetVersion) return

      const answer = parseJoinAnswer(rawAnswer)
      for (const member of this.members) {
        member.answered(answer, rooms)
      }
    }
    this.socket.emit('suite_collab_rooms', { rooms }, answered)
  }

  leave(member: HubMember) {
    this.members.delete(member)
    this.sendRoomSet()
  }
}
