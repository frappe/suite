import { useSession, type Session } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import {
  transport,
  TransportError,
  type RequestOutcome,
  type RequestScope,
} from '@/platform/transport'

import { api } from './generated'

/**
 * Share-link codes this browser holds, and which nodes each one opens.
 *
 * The Drive client is the only module that selects link codes. A request for a
 * node sends the code that reached it and nothing else (spec §7.1, Drive
 * §6.2). Platform transport sends the header it is given.
 */

/** Drive spec §4.7: one request carries at most 20 link codes. */
export const LINK_CAP = 20
export const MAX_LINKS = 50
export const MAX_TAGS = 1000

const STORE_KEY = 'suite:drive-links'
const GUEST_NAME_KEY = 'suite:drive-guest-name'
const HEADER = 'X-Drive-Links'
const TOKEN = /^[A-Za-z0-9]{22}$/
const TICKET = /^(\d{1,10})\.[0-9a-f]{64}$/

export interface LinkEntry {
  /** The node the link opens. */
  target: string
  /** The unlock ticket of a password link, `<exp>.<mac>` (Drive §4.8). */
  ticket?: string
  lastUsed: number
}

/** Node ids that one request can cover, and the credentials for that request. */
export interface LinkGroup {
  nodeIds: string[]
  scope: RequestScope
}

export interface ScopeOptions {
  /** The response is a node or a page of nodes. Tag them with the code that reached them. */
  returnsNodes?: boolean
  /** The node the request reads itself. A 404 on it ends a link that targets it. */
  subject?: string
}

export interface LinkStore {
  /** Remembers a share link and the node it opens. A malformed token is ignored. */
  seed(code: string, target: string): void
  /** Stores the unlock ticket that a password link returned. */
  unlock(code: string, ticket: string): void
  /** The code a request for this node would send. `undefined` when no held link reaches it. */
  codeFor(node: string): string | undefined
  /**
   * Credentials for one request that touches these nodes. Throws
   * `CredentialOverflowError` when they need more than 20 codes.
   *
   * The outcome updates the store. With one code sent: a 410, or a 404 on the
   * link's target as `subject`, forgets the link, and a 401 `DriveLocked`
   * forgets the ticket that was sent. With several codes sent, a 410 or a 401
   * `DriveLocked` names none of them, so each link is checked again on its
   * own by reading its target with only its code.
   */
  scope(nodeIds: readonly string[], options?: ScopeOptions): RequestScope
  /**
   * Credentials that carry every held code, at most 20: the codes of the
   * `always` nodes, then the most recently used others. For a request that
   * asks the server which nodes these links open, so a later request can send
   * only the code for each node.
   */
  scopeHeld(always?: readonly string[]): RequestScope
  /**
   * Splits node ids into ordered groups that each fit one request. Every group
   * also carries the codes of the `always` nodes, such as a document's own.
   */
  group(nodeIds: readonly string[], always?: readonly string[]): LinkGroup[]
  /** The code that reaches `node` today, or `null`. It reads and changes nothing. */
  linkFor(node: string): string | null
  /** The name a guest typed for comments. `null` while signed in. */
  guestName(): string | null
  setGuestName(name: string): void
  /** Forgets every link, tag and the guest name. Sign out calls it. */
  clear(): void
}

export class CredentialOverflowError extends TransportError<'DriveLinkLimit'> {
  constructor() {
    super({
      type: 'DriveLinkLimit',
      message: __('These items come from more than 20 share links. Select fewer and try again.'),
      status: 0,
    })
    this.name = 'CredentialOverflowError'
  }
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Reads one link's target with only that link's credential. */
export type LinkCheck = (
  target: string,
  headers: Readonly<Record<string, string>>,
) => Promise<RequestOutcome>

export interface LinkStoreOptions {
  storage: KeyValueStorage
  session: Session
  /** Where `storage` events from other tabs arrive. */
  events?: EventTarget
  check?: LinkCheck
}

/** Links keep their order: the least recently used comes first. So do tags. */
interface State {
  links: Map<string, LinkEntry>
  tags: Map<string, string>
}

/** One code as a request sent it. */
interface Sent {
  code: string
  ticket?: string
}

interface Settlement {
  sent: Sent[]
  options: ScopeOptions
  /** The store's generation when the request left. A clear since then voids the outcome. */
  generation: number
}

interface Persisted {
  links: Record<string, LinkEntry>
  /** `[node, code]`, oldest first. An array keeps the order that a numeric-looking key would lose. */
  tags: Array<[string, string]>
}

export function createLinkStore(options: LinkStoreOptions): LinkStore {
  const { storage, session, check } = options

  // The working copy. Storage is the shared copy. Each read compares the stored
  // text with the text this copy came from, and reloads when another tab
  // changed it. A write that storage refuses keeps the working copy.
  let memory: State = emptyState()
  let lastText: string | null = null
  let generation = 0

  function current(): State {
    const text = read(STORE_KEY)
    if (text !== lastText) {
      memory = parse(text)
      lastText = text
    }
    return memory
  }

  function update<Result>(change: (state: State) => Result): Result {
    const state = current()
    const result = change(state)
    const text = state.links.size ? JSON.stringify(serialize(state)) : null
    if (text !== lastText) {
      try {
        if (text === null) storage.removeItem(STORE_KEY)
        else storage.setItem(STORE_KEY, text)
        lastText = text
      } catch {
        // A full or blocked storage keeps the stored copy. This tab keeps its working copy.
      }
    }
    return result
  }

  /** Blocked storage reads as unchanged for the store, and as empty for the guest name. */
  function read(key: string): string | null {
    try {
      return storage.getItem(key)
    } catch {
      return key === STORE_KEY ? lastText : null
    }
  }

  function forgetAll(): void {
    memory = emptyState()
    lastText = null
    generation += 1
  }

  options.events?.addEventListener('storage', (event) => {
    const { key, newValue } = event as StorageEvent
    // Another tab cleared the store, as sign out does. Drop this tab's copy and
    // void every response still on its way.
    if ((key === STORE_KEY || key === null) && newValue === null) forgetAll()
  })

  function codeFor(state: State, node: string): string | undefined {
    const tagged = state.tags.get(node)
    if (tagged) return tagged
    // The most recently used link for this target wins. Links are ordered oldest first.
    let newest: string | undefined
    for (const [code, entry] of state.links) if (entry.target === node) newest = code
    return newest
  }

  function useLink(state: State, code: string): LinkEntry {
    const entry = state.links.get(code)!
    state.links.delete(code)
    entry.lastUsed = Date.now()
    state.links.set(code, entry)
    return entry
  }

  function tag(state: State, node: string, code: string): void {
    state.tags.delete(node)
    state.tags.set(node, code)
    for (const oldest of state.tags.keys()) {
      if (state.tags.size <= MAX_TAGS) break
      state.tags.delete(oldest)
    }
  }

  function forget(state: State, code: string): void {
    state.links.delete(code)
    for (const [node, tagged] of state.tags) if (tagged === code) state.tags.delete(node)
  }

  function codesFor(state: State, nodeIds: readonly string[]): Set<string> {
    const codes = new Set<string>()
    for (const node of nodeIds) {
      const code = codeFor(state, node)
      if (!code) continue
      codes.add(code)
      if (state.tags.has(node)) tag(state, node, code)
    }
    return codes
  }

  /** Each code as it is sent: bare, or with its ticket while the ticket lives. */
  function send(state: State, codes: Iterable<string>): Sent[] {
    return [...codes].map((code) => {
      const entry = useLink(state, code)
      const expires = Number(entry.ticket?.match(TICKET)?.[1] ?? 0)
      if (entry.ticket && expires * 1000 > Date.now()) return { code, ticket: entry.ticket }
      delete entry.ticket
      return { code }
    })
  }

  function scopeFor(settlement: Settlement): RequestScope {
    if (!settlement.sent.length) return { headers: {} }
    return {
      headers: header(settlement.sent),
      settled: (outcome) => settle(settlement, outcome),
    }
  }

  function settle(settlement: Settlement, outcome: RequestOutcome): void {
    if (settlement.generation !== generation) return
    const [only, ...others] = settlement.sent
    if (only && !others.length) {
      update((state) => settleOne(state, only, settlement.options, outcome))
      return
    }
    if (outcome.ok || !check || !linkRefused(outcome.error)) return
    for (const sent of settlement.sent) {
      const target = current().links.get(sent.code)?.target
      if (!target) continue
      const recheck: Settlement = { sent: [sent], options: { subject: target }, generation }
      void check(target, header([sent])).then((result) => settle(recheck, result))
    }
  }

  function settleOne(state: State, sent: Sent, scope: ScopeOptions, outcome: RequestOutcome): void {
    const entry = state.links.get(sent.code)
    if (!entry) return
    if (outcome.ok) {
      if (!scope.returnsNodes) return
      for (const node of returnedNodes(outcome.output)) tag(state, node, sent.code)
      return
    }
    const { status, type } = outcome.error
    if (status === 410 || (status === 404 && scope.subject === entry.target)) {
      forget(state, sent.code)
    } else if (
      status === 401 &&
      type === 'DriveLocked' &&
      sent.ticket &&
      entry.ticket === sent.ticket
    ) {
      delete entry.ticket
    }
  }

  const store: LinkStore = {
    seed(code, target) {
      if (!TOKEN.test(code) || !target) return
      update((state) => {
        state.links.set(code, { ...state.links.get(code), target, lastUsed: Date.now() })
        useLink(state, code)
        // A newer link for the same item replaces the code its target was tagged with.
        if (state.tags.has(target)) tag(state, target, code)
        while (state.links.size > MAX_LINKS) {
          let oldest: [string, number] | null = null
          for (const [key, entry] of state.links) {
            if (!oldest || entry.lastUsed < oldest[1]) oldest = [key, entry.lastUsed]
          }
          forget(state, oldest![0])
        }
      })
    },

    unlock(code, ticket) {
      if (!TICKET.test(ticket)) return
      update((state) => {
        if (state.links.has(code)) useLink(state, code).ticket = ticket
      })
    },

    codeFor(node) {
      return codeFor(current(), node)
    },

    scope(nodeIds, scopeOptions = {}) {
      const sent = update((state) => {
        const codes = codesFor(state, nodeIds)
        if (codes.size > LINK_CAP) throw new CredentialOverflowError()
        return send(state, codes)
      })
      return scopeFor({ sent, options: scopeOptions, generation })
    },

    scopeHeld(always = []) {
      const sent = update((state) => {
        const base = codesFor(state, always)
        if (base.size > LINK_CAP) throw new CredentialOverflowError()
        const others = [...state.links.keys()].filter((code) => !base.has(code))
        // Oldest first, so sending them keeps their least recently used order.
        return send(state, [
          ...others.slice(Math.max(0, others.length - (LINK_CAP - base.size))),
          ...base,
        ])
      })
      return scopeFor({ sent, options: {}, generation })
    },

    group(nodeIds, always = []) {
      const groups = update((state) => {
        const base = codesFor(state, always)
        if (base.size > LINK_CAP) throw new CredentialOverflowError()
        const found: Array<{ nodeIds: string[]; codes: Set<string> }> = []
        let current = { nodeIds: [] as string[], codes: new Set(base) }
        for (const node of nodeIds) {
          const code = codeFor(state, node)
          if (code && !current.codes.has(code) && current.codes.size >= LINK_CAP) {
            found.push(current)
            current = { nodeIds: [], codes: new Set(base) }
          }
          current.nodeIds.push(node)
          if (code) current.codes.add(code)
        }
        if (current.nodeIds.length) found.push(current)
        return found.map((group) => ({ nodeIds: group.nodeIds, sent: send(state, group.codes) }))
      })
      return groups.map((group) => ({
        nodeIds: group.nodeIds,
        scope: scopeFor({ sent: group.sent, options: {}, generation }),
      }))
    },

    linkFor(node) {
      return codeFor(current(), node) ?? null
    },

    guestName() {
      if (session.status.value !== 'guest') return null
      return read(GUEST_NAME_KEY) || null
    },

    setGuestName(name) {
      try {
        if (name) storage.setItem(GUEST_NAME_KEY, name)
        else storage.removeItem(GUEST_NAME_KEY)
      } catch {
        // Blocked storage: the name lasts until the page closes, as nothing else keeps it.
      }
    },

    clear() {
      forgetAll()
      try {
        storage.removeItem(STORE_KEY)
        storage.removeItem(GUEST_NAME_KEY)
      } catch {
        // Blocked storage holds nothing of ours.
      }
    },
  }
  session.onLogout(() => store.clear())
  return store
}

function header(sent: readonly Sent[]): Record<string, string> {
  return {
    [HEADER]: sent.map(({ code, ticket }) => (ticket ? `${code}.${ticket}` : code)).join(','),
  }
}

/** A refusal that says some link failed, without saying which one. */
function linkRefused(error: TransportError): boolean {
  return error.status === 410 || (error.status === 401 && error.type === 'DriveLocked')
}

function emptyState(): State {
  return { links: new Map(), tags: new Map() }
}

/** Reads the stored copy. Malformed entries are dropped, never thrown. */
function parse(text: string | null): State {
  const state = emptyState()
  let saved: unknown
  try {
    saved = JSON.parse(text ?? 'null')
  } catch {
    return state
  }
  if (!isRecord(saved)) return state
  for (const [code, entry] of Object.entries(isRecord(saved.links) ? saved.links : {})) {
    if (TOKEN.test(code) && isLinkEntry(entry)) {
      state.links.set(code, {
        target: entry.target,
        lastUsed: entry.lastUsed,
        ...(entry.ticket === undefined ? {} : { ticket: entry.ticket }),
      })
    }
  }
  for (const pair of Array.isArray(saved.tags) ? saved.tags : []) {
    if (!Array.isArray(pair) || pair.length !== 2) continue
    const [node, code] = pair
    if (typeof node === 'string' && node && typeof code === 'string' && state.links.has(code))
      state.tags.set(node, code)
  }
  return state
}

function isLinkEntry(value: unknown): value is LinkEntry {
  return (
    isRecord(value) &&
    typeof value.target === 'string' &&
    value.target !== '' &&
    typeof value.lastUsed === 'number' &&
    Number.isFinite(value.lastUsed) &&
    (value.ticket === undefined || (typeof value.ticket === 'string' && TICKET.test(value.ticket)))
  )
}

function serialize(state: State): Persisted {
  return { links: Object.fromEntries(state.links), tags: [...state.tags] }
}

function returnedNodes(output: unknown): string[] {
  if (!isRecord(output)) return []
  const rows = Array.isArray(output.rows) ? output.rows : [output]
  return rows.flatMap((row) => (isRecord(row) && typeof row.name === 'string' ? [row.name] : []))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** `localStorage`, or a memory copy where the browser blocks it. */
function browserStorage(): KeyValueStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // Blocked storage throws on access.
  }
  const memory = new Map<string, string>()
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
    removeItem: (key) => void memory.delete(key),
  }
}

/** Reads a link's target through the platform transport, with only the given credential. */
const checkLink: LinkCheck = (target, headers) =>
  transport.request(api.node_get, { node: target }, { headers }).then(
    (output): RequestOutcome => ({ ok: true, output }),
    (error: unknown): RequestOutcome =>
      error instanceof TransportError
        ? { ok: false, error }
        : {
            ok: false,
            error: new TransportError({ type: 'RequestError', message: String(error), status: 0 }),
          },
  )

/** The browser's link store. Sign out clears it, in this tab and in every other. */
export const driveLinks = createLinkStore({
  storage: browserStorage(),
  session: useSession(),
  events: typeof window === 'undefined' ? undefined : window,
  check: checkLink,
})
