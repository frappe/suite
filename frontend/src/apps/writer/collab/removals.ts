import * as yjs from 'yjs'

import {
  ADOPT,
  APPLIED_UPDATE,
  MERGED_UPDATE,
  type CollabRoom,
  type RoomStatus,
} from '@/platform/collab'

import { BODY_FIELD } from './field'

/** Origin of the edit that puts a removed piece of text back. */
export const TYPE_BACK = Symbol('writer-type-back')

// Yjs exports no DeleteSet type
type DeleteSet = ReturnType<typeof yjs.createDeleteSet>
type DecodedRow = ReturnType<typeof yjs.decodeUpdate>
type TextRemoval = Extract<Removal, { kind: 'text' }>

// Shorter text can match in the wrong place, so it's reported instead
const MIN_SEEN_LENGTH = 3

/** Lost text at its offset in `seen`, with the formats it had. */
export interface Run {
  offset: number
  text: string
  attrs: Record<string, unknown>
}

/** Rows wrote each client's clocks from `before` up to `after`. */
export interface RowClocks {
  before: Map<number, number>
  after: Map<number, number>
}

/**
 * Something of mine a remote row removed without naming it, because the row
 * deleted the block around it. `seen` is the text the row deleted next to mine,
 * and each run sits at its offset in `seen`. `written` is what the rows that deleted
 * `seen` wrote, and `pulled` all that the same transaction wrote. `key`, on text the doc
 * never kept or lost since, names every lost character, so a loss reported again is known.
 */
export type Removal =
  | {
      kind: 'text'
      seen: string
      runs: Run[]
      written: RowClocks
      pulled: RowClocks
      isUncertain: boolean
      key?: string
    }
  | { kind: 'node'; name: string; attrs: Record<string, unknown>; key?: string }

interface WritingStatus {
  readonly status: Pick<RoomStatus, 'canWrite'>
}

function reportIfAny(report: (removals: Removal[]) => void, removals: Removal[]) {
  if (removals.length) {
    report(removals)
  }
}

/**
 * Types back what the room's pulled rows removed of its work, or hands it to `report`
 * when there's no single place or the room can't write. Returns a stop function.
 */
export function watchRemovals(
  room: Pick<CollabRoom, 'doc' | 'ownClients' | 'onChange'> & WritingStatus,
  report: (removals: Removal[]) => void,
) {
  const found: Removal[] = []
  function collect(transaction: yjs.Transaction) {
    const updates: Uint8Array[] | undefined = transaction.meta.get(APPLIED_UPDATE)
    if (updates) {
      found.push(...findRemovals(transaction, updates, room.ownClients))
    }
  }

  // The room tells its listeners after a pull's catch, so a suspect room can't write by then
  function placeOrReport() {
    reportIfAny(report, typeBackAll(room, found.splice(0)))
  }

  room.doc.on('afterTransaction', collect)
  const stopListening = room.onChange(placeOrReport)
  return () => {
    room.doc.off('afterTransaction', collect)
    stopListening()
    // Removals the room never told of, as when it closed mid-adopt, can no longer be typed back
    reportIfAny(report, found.splice(0))
  }
}

// Returns the removals it couldn't type back
function typeBackAll(room: Pick<CollabRoom, 'doc'> & WritingStatus, removals: Removal[]) {
  if (!room.status.canWrite) {
    return removals
  }

  return removals.filter((removal) => !typeBack(room.doc, removal))
}

function unnamedTexts(deleted: yjs.Item[], named: DeleteSet) {
  const texts = new Set<yjs.AbstractType<unknown>>()
  for (const item of deleted) {
    if (item.content instanceof yjs.ContentString && hasUnnamed(item, named)) {
      texts.add(item.parent as yjs.AbstractType<unknown>)
    }
  }

  return texts
}

function deletedNodes(deleted: yjs.Item[], named: DeleteSet) {
  const nodes: Removal[] = []
  for (const item of deleted) {
    const element = elementIn(item)
    if (element && !yjs.isDeleted(named, item.id)) {
      nodes.push({ kind: 'node', name: element.nodeName, attrs: rawAttrs(element) })
    }
  }

  return nodes
}

/**
 * Text and nodes of the clients in `mine` that `transaction` deleted though none of its
 * `updates` named them, or that its updates wrote into a block yjs had already collected.
 * An adopt also reports what of its work the doc already held and lost with its block since.
 * Call from afterTransaction: deleted text is collected right after it.
 */
export function findRemovals(
  transaction: yjs.Transaction,
  updates: Uint8Array[],
  mine: ReadonlySet<number>,
): Removal[] {
  const deleted = myDeletedItems(transaction, mine)
  const isWritingMine = [...mine].some((client) => hasWritten(transaction, client))
  const isAdopting = transaction.origin === ADOPT
  if (!deleted.length && !isWritingMine && !isAdopting) {
    return []
  }

  const rows = updates.map((update) => yjs.decodeUpdate(update))
  const named = yjs.mergeDeleteSets(rows.map((row) => row.ds))
  const removals: Removal[] = []
  if (isWritingMine || isAdopting) {
    const merged = transaction.meta.get(MERGED_UPDATE) ?? yjs.mergeUpdates(updates)
    unkeptWrites({ transaction, named, removals, lostIds: new Map() }, merged, mine)
  }

  removals.push(...deletedNodes(deleted, named))
  for (const text of unnamedTexts(deleted, named)) {
    removals.push(textRemoval(text, transaction, rows, named, mine))
  }

  return removals
}

// Splits items at the delete boundaries; yjs merges them back after afterTransaction
function myDeletedItems(transaction: yjs.Transaction, mine: ReadonlySet<number>) {
  const myDeletes = yjs.createDeleteSet()
  for (const [client, ranges] of transaction.deleteSet.clients) {
    if (mine.has(client)) {
      myDeletes.clients.set(client, ranges)
    }
  }

  const deleted: yjs.Item[] = []
  yjs.iterateDeletedStructs(transaction, myDeletes, (struct) => {
    if (struct instanceof yjs.Item) {
      deleted.push(struct)
    }
  })
  return deleted
}

function hasUnnamed(item: yjs.Item, named: DeleteSet) {
  const { client, clock } = item.id
  const offsets = [...Array(item.length).keys()]
  return offsets.some((offset) => !yjs.isDeleted(named, yjs.createID(client, clock + offset)))
}

function elementIn(item: yjs.Item) {
  const { content } = item
  if (content instanceof yjs.ContentType && content.type instanceof yjs.XmlElement) {
    return content.type
  }

  return null
}

function emptyTextRemoval(transaction: yjs.Transaction): TextRemoval {
  return {
    kind: 'text',
    seen: '',
    runs: [],
    written: clocksOf([]),
    pulled: pulledOf(transaction),
    isUncertain: false,
  }
}

function collectChars(
  removal: TextRemoval,
  found: SeenChars,
  text: yjs.AbstractType<unknown>,
  transaction: yjs.Transaction,
  named: DeleteSet,
  mine: ReadonlySet<number>,
) {
  let attrs: Record<string, unknown> = {}
  let run: Run | null = null
  for (let item = text._start; item; item = item.right) {
    if (item.content instanceof yjs.ContentFormat && wasLive(item, transaction)) {
      attrs = withFormat(attrs, item.content)
      run = null
    }

    if (!(item.content instanceof yjs.ContentString)) {
      continue
    }

    for (let index = 0; index < item.length; index++) {
      const id = yjs.createID(item.id.client, item.id.clock + index)
      const state = { ...charState(id, transaction, named, mine), attrs, id }
      run = addChar(removal, found, run, item.content.str[index], state)
    }
  }
}

// Reports must never be deduped against live text: the same words may be someone else's
function textRemoval(
  text: yjs.AbstractType<unknown>,
  transaction: yjs.Transaction,
  rows: DecodedRow[],
  named: DeleteSet,
  mine: ReadonlySet<number>,
) {
  const removal = emptyTextRemoval(transaction)
  const found: SeenChars = { gaps: new Set(), seenIds: [] }
  collectChars(removal, found, text, transaction, named, mine)
  const { gaps, seenIds } = found
  const namingRows = rows.filter((row) => seenIds.some((id) => yjs.isDeleted(row.ds, id)))
  removal.written = clocksOf(namingRows)
  removal.isUncertain = removal.runs.some((lost) => gaps.has(lost.offset))
  return removal
}

function pulledOf(transaction: yjs.Transaction): RowClocks {
  return { before: new Map(transaction.beforeState), after: new Map(transaction.afterState) }
}

function hasWritten(transaction: yjs.Transaction, client: number) {
  return (transaction.afterState.get(client) ?? 0) > (transaction.beforeState.get(client) ?? 0)
}

interface Chain {
  lastId: yjs.ID | null
  attrs: Record<string, unknown>
  removal: TextRemoval | null
  run: Run | null
}

interface UnkeptContext {
  transaction: yjs.Transaction
  named: DeleteSet
  removals: Removal[]
  lostIds: Map<TextRemoval, yjs.ID[]>
}

// Yjs keeps what lands in a collected block only as a GC struct, so no deleteSet names it
function unkeptWrites(context: UnkeptContext, merged: Uint8Array, mine: ReadonlySet<number>) {
  const chain: Chain = { lastId: null, attrs: {}, removal: null, run: null }
  for (const struct of yjs.decodeUpdate(merged).structs) {
    if (struct instanceof yjs.Item && struct.parentSub === null && mine.has(struct.id.client)) {
      followChain(chain, struct, context)
    }
  }

  for (const [removal, ids] of context.lostIds) {
    removal.key = keyOf(ids)
  }
}

// A client:clock+length per stretch of lost IDs in a row
function keyOf(ids: yjs.ID[]) {
  const stretches: { client: number; clock: number; length: number }[] = []
  for (const { client, clock } of ids) {
    const last = stretches.at(-1)
    const canExtendLast = last?.client === client && last.clock + last.length === clock
    if (canExtendLast) {
      last.length++
    } else {
      stretches.push({ client, clock, length: 1 })
    }
  }

  return stretches.map(({ client, clock, length }) => `${client}:${clock}+${length}`).join(',')
}

// Text typed in one go chains by origin, so a chain's formats and runs belong together
function followChain(chain: Chain, item: yjs.Item, context: UnkeptContext) {
  if (!yjs.compareIDs(item.origin, chain.lastId)) {
    Object.assign(chain, { attrs: {}, removal: null, run: null })
  }

  chain.lastId = item.lastId
  const { content } = item
  if (content instanceof yjs.ContentString) {
    addUnkeptText(chain, item, content.str, context)
  } else if (content instanceof yjs.ContentFormat) {
    chain.attrs = withFormat(chain.attrs, content)
    chain.run = null
  } else if (content instanceof yjs.ContentType) {
    addUnkeptNode(item, content.type, context)
    chain.run = null
  }
}

// What the update deleted of its own text doesn't end the run around it
function addUnkeptText(chain: Chain, item: yjs.Item, str: string, context: UnkeptContext) {
  for (let index = 0; index < item.length; index++) {
    const id = yjs.createID(item.id.client, item.id.clock + index)
    if (yjs.isDeleted(context.named, id)) {
      continue
    }

    if (!isUnkept(id, context.transaction)) {
      chain.run = null
      continue
    }

    extendRun(chain, context, str[index], id)
  }
}

function extendRun(
  chain: Chain,
  { transaction, removals, lostIds }: UnkeptContext,
  char: string,
  id: yjs.ID,
) {
  if (!chain.removal) {
    chain.removal = emptyTextRemoval(transaction)
    removals.push(chain.removal)
    lostIds.set(chain.removal, [])
  }

  if (!chain.run) {
    chain.run = { offset: 0, text: '', attrs: chain.attrs }
    chain.removal.runs.push(chain.run)
  }

  chain.run.text += char
  lostIds.get(chain.removal)?.push(id)
}

function addUnkeptNode(
  item: yjs.Item,
  type: yjs.AbstractType<unknown>,
  { transaction, named, removals }: UnkeptContext,
) {
  if (
    type instanceof yjs.XmlElement &&
    !yjs.isDeleted(named, item.id) &&
    isUnkept(item.id, transaction)
  ) {
    removals.push({ kind: 'node', name: type.nodeName, attrs: {}, key: keyOf([item.id]) })
  }
}

// Written by this transaction, yet the doc holds only a GC struct there; or adopted work the doc
// already held, pulled as another tab's, that has gone with its block since
function isUnkept(id: yjs.ID, transaction: yjs.Transaction) {
  const pulled = { before: transaction.beforeState, after: transaction.afterState }
  if (wroteIn(pulled, id.client, id.clock)) {
    return yjs.getItem(transaction.doc.store, id) instanceof yjs.GC
  }

  const isHeld = id.clock < (transaction.beforeState.get(id.client) ?? 0)
  return transaction.origin === ADOPT && isHeld && isGoneWithBlock(transaction, id)
}

function isGoneWithBlock(transaction: yjs.Transaction, id: yjs.ID) {
  const struct: yjs.Item | yjs.GC = yjs.getItem(transaction.doc.store, id)
  if (struct instanceof yjs.GC) {
    return true
  }

  const parent = struct.parent as yjs.AbstractType<unknown>
  return struct.deleted && !!parent._item?.deleted
}

// Only the rows that deleted the old text wrote its copy; rows pulled with them may write around it
function clocksOf(rows: DecodedRow[]): RowClocks {
  const written: RowClocks = { before: new Map(), after: new Map() }
  for (const struct of rows.flatMap((row) => row.structs)) {
    if (struct instanceof yjs.Skip) {
      continue
    }

    const { client, clock } = struct.id
    written.before.set(client, Math.min(written.before.get(client) ?? clock, clock))
    written.after.set(client, Math.max(written.after.get(client) ?? 0, clock + struct.length))
  }

  return written
}

// Lost: deleted without the row naming it, mine or someone else's. Seen: deleted and named by the row
function charState(
  id: yjs.ID,
  transaction: yjs.Transaction,
  named: DeleteSet,
  mine: ReadonlySet<number>,
) {
  const isDeletedNow = yjs.isDeleted(transaction.deleteSet, id)
  const isNamed = yjs.isDeleted(named, id)
  const isMine = mine.has(id.client)
  const isUnnamed = isDeletedNow && !isNamed
  return {
    isLost: isMine && isUnnamed,
    isOtherLost: !isMine && isUnnamed,
    isSeen: isDeletedNow && isNamed,
  }
}

function wasLive(item: yjs.Item, transaction: yjs.Transaction) {
  return !item.deleted || yjs.isDeleted(transaction.deleteSet, item.id)
}

function withFormat(attrs: Record<string, unknown>, format: yjs.ContentFormat) {
  const next = { ...attrs }
  if (format.value === null) {
    delete next[format.key]
  } else {
    next[format.key] = format.value
  }

  return next
}

interface SeenChars {
  gaps: Set<number>
  seenIds: yjs.ID[]
}

interface CharState {
  id: yjs.ID
  isLost: boolean
  isOtherLost: boolean
  isSeen: boolean
  attrs: Record<string, unknown>
}

// Returns the run the next lost char joins; `gaps` gets the offsets of other clients' lost chars
function addChar(
  removal: { seen: string; runs: Run[] },
  { gaps, seenIds }: SeenChars,
  run: Run | null,
  char: string,
  state: CharState,
) {
  if (state.isOtherLost) {
    gaps.add(removal.seen.length)
  }

  if (!state.isLost) {
    if (state.isSeen) {
      removal.seen += char
      seenIds.push(state.id)
    }

    return null
  }

  const current = run ?? { offset: removal.seen.length, text: '', attrs: state.attrs }
  if (!run) {
    removal.runs.push(current)
  }

  current.text += char
  return current
}

// getAttributes skips a deleted element's entries, so read the latest value of each key
function rawAttrs(element: yjs.XmlElement) {
  const attrs: Record<string, unknown> = {}
  for (const [key, item] of element._map) {
    const values = item.content.getContent()
    attrs[key] = values[values.length - 1]
  }

  return attrs
}

/**
 * Puts a text removal back where exactly one run of text the rows that deleted `seen`
 * wrote equals it, past what other rows of the pull wrote inside it. Returns false when
 * there's no such place, or more than one, or when the row also removed someone else's
 * text at a run's offset without naming it.
 */
export function typeBack(doc: yjs.Doc, removal: Removal) {
  if (removal.kind !== 'text' || removal.isUncertain || removal.seen.length < MIN_SEEN_LENGTH) {
    return false
  }

  const { seen, written, pulled } = removal
  const body = doc.getXmlFragment(BODY_FIELD)
  const matches = liveTexts(body).flatMap((text) => placesIn(text, seen, written, pulled))
  if (matches.length !== 1) {
    return false
  }

  const [{ text, liveIndexes }] = matches
  const runs = [...removal.runs].reverse()
  doc.transact(() => {
    for (const run of runs) {
      // A copy, since insert sets every format it isn't given to null on the object
      text.insert(liveIndexes[run.offset], run.text, { ...run.attrs })
    }
  }, TYPE_BACK)
  return true
}

function liveTexts(parent: yjs.XmlFragment | yjs.XmlElement): yjs.XmlText[] {
  return parent.toArray().flatMap((child) => {
    if (child instanceof yjs.XmlText) {
      return [child]
    }

    if (child instanceof yjs.XmlElement) {
      return liveTexts(child)
    }

    return []
  })
}

// Each whole run of live chars the rows wrote that equals `seen`, with each char's live index and one past the last
function placesIn(text: yjs.XmlText, seen: string, written: RowClocks, pulled: RowClocks) {
  const places: { text: yjs.XmlText; liveIndexes: number[] }[] = []
  for (const span of rowSpans(text, written, pulled)) {
    if (span.text === seen) {
      const { liveIndexes } = span
      places.push({ text, liveIndexes: [...liveIndexes, liveIndexes[liveIndexes.length - 1] + 1] })
    }
  }

  return places
}

// Other rows of the pull, like a type-back, may write inside the copy, so their chars don't end a span
function rowSpans(text: yjs.XmlText, written: RowClocks, pulled: RowClocks) {
  const spans: { liveIndexes: number[]; text: string }[] = []
  let span: { liveIndexes: number[]; text: string } | null = null
  for (const [at, { char, isFromRow, isFromPull }] of liveChars(text, written, pulled).entries()) {
    if (isFromPull) {
      continue
    }

    if (!isFromRow) {
      span = null
      continue
    }

    if (!span) {
      span = { liveIndexes: [], text: '' }
      spans.push(span)
    }

    span.liveIndexes.push(at)
    span.text += char
  }

  return spans
}

function liveChars(text: yjs.XmlText, written: RowClocks, pulled: RowClocks) {
  const chars: { char: string; isFromRow: boolean; isFromPull: boolean }[] = []
  for (let item = text._start; item; item = item.right) {
    if (item.deleted || !(item.content instanceof yjs.ContentString)) {
      continue
    }

    const { client, clock } = item.id
    for (let index = 0; index < item.length; index++) {
      const isFromRow = wroteIn(written, client, clock + index)
      const isFromPull = !isFromRow && wroteIn(pulled, client, clock + index)
      chars.push({ char: item.content.str[index], isFromRow, isFromPull })
    }
  }

  return chars
}

function wroteIn(written: RowClocks, client: number, clock: number) {
  const before = written.before.get(client) ?? 0
  const after = written.after.get(client) ?? 0
  return clock >= before && clock < after
}
