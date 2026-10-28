// The editor's side of collaboration (collab v1): the sheet's live room, and
// everything the editor shows from it. Used only when the site's Sheets mode
// is on; otherwise open() answers 'disabled' and the old save path runs.
//
// What the editor gets:
// - dispatch/commit/localOnly: every IronCalc command goes through the glue,
//   and each user action ends in one commit (one undo step, one push);
// - undo/redo: this tab's own steps only (collab/undo.ts), with the selection
//   each step was made with and a toast when someone else's edit is in the way;
// - status, saveState, editingState, banner: saving, offline, full, lost access
//   (collab/messages.ts);
// - users and cursors: who else is here and what they have selected
//   (collab/presence.ts);
// - restore: a version, through the room (collab/restore.ts).

import { toast } from 'frappe-ui'
import { computed, shallowRef } from 'vue'

import { type CollabSession, type RoomStatus } from '@/platform/collab'
import { useSession } from '@/platform/session'

import { bannerFor, editingStateOf, saveStateOf, UPGRADING_BANNER } from '../../collab/messages'
import { createPeople } from '../../collab/people'
import { GUEST_USER, readPresence, sendSelection } from '../../collab/presence'
import { restoreVersion, type RestoreNotice } from '../../collab/restore'
import { isLiveNow, openSheetRoom, type SheetRoom } from '../../collab/room'
import type { Selection } from '../../collab/selection'
import type { GlueStores } from '../../collab/stores'
import { createUndo, type Undo } from '../../collab/undo'
import type { WorkbookClient } from '../../core/client'

type RemoteChange = Parameters<Parameters<SheetRoom['glue']['onRemote']>[0]>[0]

export interface CollabRoomOptions {
  session: CollabSession
  /** The editor's side stores, read when the room opens. */
  getStores: () => GlueStores
  /** The editor's selection, for undo steps and presence. */
  getSelection: () => Selection | null
  /** Another tab's change (or an undo) reached IronCalc and the stores: repaint what it touched. */
  onRemote: (change: RemoteChange) => void
  /** The room asks to be opened again (a quarantine, a restore elsewhere): remount the editor. */
  onReopen: () => void
  /** Tests pass fakes. */
  open?: typeof openSheetRoom
  probe?: typeof isLiveNow
  retryMs?: number
}

// While a sheet waits for its conversion, ask again this often.
const CONVERSION_RETRY_MS = 5000

export function useCollabRoom({
  session,
  getStores,
  getSelection,
  onRemote,
  onReopen,
  open = openSheetRoom,
  probe = isLiveNow,
  retryMs = CONVERSION_RETRY_MS,
}: CollabRoomOptions) {
  const sheet = shallowRef<SheetRoom | null>(null)
  const status = shallowRef<RoomStatus | null>(null)
  const waiting = shallowRef(false)
  const canUndo = shallowRef(false)
  const canRedo = shallowRef(false)
  const presenceTick = shallowRef(0)
  const people = createPeople()
  const me = useSession().user.value?.id ?? GUEST_USER
  let undo: Undo | null = null
  let offs: (() => void)[] = []
  let closed = false
  let retry: ReturnType<typeof setTimeout> | undefined
  let commitSoon: ReturnType<typeof setTimeout> | undefined

  /** 'live': the workbook in `client` is the room's. */
  async function openRoom(client: WorkbookClient): Promise<'live' | 'disabled' | 'unconverted'> {
    const opened = await open({ session, client, stores: getStores() })
    if (opened.state !== 'live') {
      if (opened.state === 'unconverted') waitForConversion()
      return opened.state
    }
    if (closed) {
      await opened.sheet.close()
      return 'disabled'
    }
    attach(opened.sheet)
    return 'live'
  }

  // The editor shows the old body read-only meanwhile; once the sheet opens
  // live, the editor is opened again on it.
  function waitForConversion() {
    waiting.value = true
    retry = setTimeout(async () => {
      if (closed) return
      const live = await probe(session).catch(() => false)
      if (closed) return
      if (live) onReopen()
      else waitForConversion()
    }, retryMs)
  }

  function attach(s: SheetRoom) {
    sheet.value = s
    const { room, glue, doc } = s
    status.value = room.status
    offs.push(
      room.onChange(() => {
        status.value = room.status
        const st = room.status
        if (st.isReopenNeeded && (!st.unsentCount || st.isKeptOnDevice)) onReopen()
      }),
    )
    offs.push(
      glue.onRemote((change) => {
        onRemote(change)
        presenceTick.value++ // rows moved under someone's box
      }),
    )
    if (room.presence) offs.push(room.presence.onChange(() => presenceTick.value++))
    undo = createUndo({ doc, glue, getSelection })
    const flags = () => {
      canUndo.value = !!undo?.canUndo()
      canRedo.value = !!undo?.canRedo()
    }
    offs.push(undo.onChange(flags))
    flags()
  }

  const isLive = computed(() => sheet.value !== null)

  function dispatch(cmd: unknown) {
    sheet.value!.glue.dispatch(cmd)
    // A command whose action never says it ended still reaches the doc.
    clearTimeout(commitSoon)
    commitSoon = setTimeout(() => void commit())
  }

  /** End of a user action: everything since the last commit becomes one step. */
  function commit(): Promise<void> {
    const s = sheet.value
    if (!s) return Promise.resolve()
    return s.glue.commit().catch((e) => console.error('[sheets] collab commit failed', e))
  }

  function localOnly<T>(fn: () => T): T {
    return sheet.value ? sheet.value.glue.localOnly(fn) : fn()
  }

  // Undo/redo, and what the person is told when someone else's edit is in the way.
  async function step(which: 'undo' | 'redo') {
    if (!undo) return null
    const result = await (which === 'undo' ? undo.undo() : undo.redo())
    if (result.refused === 'edited') toast.info("Can't undo: someone else edited it")
    if (result.refused === 'partial')
      toast.info("Some cells weren't undone: someone else edited them")
    return result
  }

  const saveState = computed(() => (status.value ? saveStateOf(status.value) : null))
  const editingState = computed(() => {
    if (waiting.value) return 'closed'
    return status.value ? editingStateOf(status.value) : 'editing'
  })
  const banner = computed(() => {
    if (waiting.value) return UPGRADING_BANNER
    return status.value ? bannerFor(status.value) : null
  })

  const presence = computed(() => {
    void presenceTick.value
    const s = sheet.value
    if (!s?.room.presence) return { users: [], cursors: new Map() }
    return readPresence(s.room.presence, s.doc, me, people.person)
  })
  const users = computed(() => presence.value.users)
  const cursors = computed(() => presence.value.cursors)

  function shareSelection(sel: Selection | null) {
    const s = sheet.value
    if (s?.room.presence) sendSelection(s.room.presence, s.doc, sel)
  }

  async function restore(seq: number, bytes: Uint8Array): Promise<RestoreNotice> {
    const s = sheet.value
    if (!s) return { isRestored: false, message: 'The version was not restored.' }
    await s.glue.settled()
    return restoreVersion(s.room, seq, bytes)
  }

  async function flush() {
    const s = sheet.value
    if (!s) return
    await s.glue.settled()
    await s.room.flush()
  }

  async function close() {
    closed = true
    clearTimeout(retry)
    clearTimeout(commitSoon)
    for (const off of offs) off()
    offs = []
    undo?.stop()
    undo = null
    const s = sheet.value
    sheet.value = null
    await s?.close()
  }

  return {
    open: openRoom,
    isLive,
    waiting,
    dispatch,
    commit,
    localOnly,
    undo: () => step('undo'),
    redo: () => step('redo'),
    canUndo,
    canRedo,
    status,
    saveState,
    editingState,
    banner,
    users,
    cursors,
    shareSelection,
    restore,
    flush,
    close,
  }
}
