import {
  GENERAL,
  PUBLIC,
  groupName,
  isExpired,
  principalKind,
  type DriveGrant,
  type GrantExplanation,
  type GrantList,
  type InheritedGrant,
  type PrincipalKind,
} from '@/apps/drive/client/grants'

/**
 * What the share dialog shows, derived from one grants read (unified spec §7.3).
 * The dialog renders this and never decides access itself.
 */

export interface LocalRow {
  grant: DriveGrant
  kind: PrincipalKind
  expired: boolean
  /** An explicit deny: "Denied here" with Allow again. */
  denied: boolean
}

export interface InheritedRow {
  entry: InheritedGrant
  kind: PrincipalKind
  /**
   * "Deny access here" applies: the row gives access, no local row exists for
   * its principal yet, and a redacted link names no principal to deny.
   */
  deniable: boolean
}

export interface InheritedPart {
  node: string
  title: string
  rows: InheritedRow[]
}

/** The effective state of everyone at the org, or of Public on the web (§7.6). */
export type GeneralAccess =
  | { state: 'off' }
  | { state: 'local'; row: LocalRow }
  | { state: 'denied'; row: LocalRow }
  | { state: 'inherited'; entry: InheritedGrant }
  /** An expired local row stays listed, greyed, with Remove (§7.9). `entry` is what applies meanwhile. */
  | { state: 'expired'; row: LocalRow; entry: InheritedGrant | null }

export interface ShareSections {
  people: LocalRow[]
  organization: GeneralAccess
  /** `null` on a root: a root cannot be public (Drive spec §6.5). */
  public: GeneralAccess | null
  /** `null` on a root: a root has no share links (Drive spec §4.9). */
  links: LocalRow[] | null
  inherited: InheritedPart[]
}

export function shareSections(list: GrantList, nodeKind: string, now = new Date()): ShareSections {
  const isRoot = nodeKind === 'root'
  const local = list.grants.map((grant): LocalRow => ({
    grant,
    kind: principalKind(grant.principal),
    expired: isExpired(grant, now),
    denied: grant.role <= 0,
  }))
  const localPrincipals = new Set(list.grants.map((grant) => grant.principal))

  const parts = new Map<string, InheritedPart>()
  for (const entry of list.inherited) {
    const kind = principalKind(entry.grant.principal)
    // A deny needs no deny. A redacted link hides its principal, and a root has
    // no public access to deny.
    const deniable =
      entry.grant.role > 0 &&
      !entry.redacted &&
      !(isRoot && kind === 'public') &&
      !localPrincipals.has(entry.grant.principal)
    const part = parts.get(entry.source_node) ?? { node: entry.source_node, title: entry.source_title, rows: [] }
    part.rows.push({ entry, kind, deniable })
    parts.set(entry.source_node, part)
  }

  return {
    people: local.filter((row) => row.kind === 'user' || row.kind === 'group'),
    organization: generalAccess(GENERAL, local, list.inherited),
    public: isRoot ? null : generalAccess(PUBLIC, local, list.inherited),
    links: isRoot ? null : local.filter((row) => row.kind === 'link'),
    inherited: [...parts.values()],
  }
}

function generalAccess(principal: string, local: LocalRow[], inherited: InheritedGrant[]): GeneralAccess {
  const row = local.find((candidate) => candidate.grant.principal === principal)
  // `inherited` is nearest first, and the nearest live row decides.
  const nearest = inherited.find((entry) => entry.grant.principal === principal)
  const applies = nearest && nearest.grant.role > 0 ? nearest : null
  if (row?.expired) return { state: 'expired', row, entry: applies }
  if (row?.denied) return { state: 'denied', row }
  if (row) return { state: 'local', row }
  return applies ? { state: 'inherited', entry: applies } : { state: 'off' }
}

/** One write to the node's own rows. `role: null` removes the principal's row. */
export interface GrantChange {
  principal: string
  role: number | null
}

/**
 * The role `me` would hold on `node` after `change`, worked out from the
 * explanation of `me` (Drive spec §5.3, §5.8). The share dialog asks before a
 * write that lowers the caller's own access (§7.4).
 *
 * The rules match the server's resolver. Own principals (the user, then
 * groups, then everyone at the org) resolve nearest first. At one depth the
 * user beats a group, and a group beats the org. Among equals a deny wins,
 * else the highest role. Open principals (public, links) take the nearest
 * row. An own deny wins outright, else the higher of the two.
 *
 * Group membership is known only for groups that already hold a row on the
 * chain: the explanation marks those `held`.
 */
export function roleAfter(explanation: GrantExplanation, node: string, change: GrantChange, me: string): number {
  if (explanation.source === 'site admin') return explanation.role
  const rows = explanation.rows
  const nodeDepth = rows.find((row) => row.node === node)?.depth ?? Math.max(-1, ...rows.map((row) => row.depth)) + 1
  const held = (principal: string) =>
    principal === me || principal === GENERAL || principal === PUBLIC || rows.some((row) => row.principal === principal && row.held)
  const after = rows
    .filter((row) => row.held && !(row.node === node && row.principal === change.principal))
    .map(({ principal, role, depth }) => ({ principal, role, depth }))
  if (change.role !== null && held(change.principal)) {
    after.push({ principal: change.principal, role: change.role, depth: nodeDepth })
  }
  return resolveRole(after)
}

const OWN_TIER: Partial<Record<PrincipalKind, number>> = { user: 0, group: 1, general: 2 }

function resolveRole(rows: { principal: string; role: number; depth: number }[]): number {
  let own: number | null = null
  let ownDepth = -1
  let ownTier = 9
  let open: number | null = null
  let openDepth = -1
  for (const { principal, role, depth } of rows) {
    const tier = OWN_TIER[principalKind(principal)]
    if (tier === undefined) {
      if (depth > openDepth) [open, openDepth] = [role, depth]
      else if (depth === openDepth && role > (open ?? 0)) open = role
    } else if (depth > ownDepth || (depth === ownDepth && tier < ownTier)) {
      ;[own, ownDepth, ownTier] = [role, depth, tier]
    } else if (depth === ownDepth && tier === ownTier) {
      own = own === 0 || role === 0 ? 0 : Math.max(own ?? 0, role)
    }
  }
  return own === 0 ? 0 : Math.max(own ?? 0, open ?? 0)
}

/**
 * Why a principal still has access after its local row went (§7.4), or
 * `null` when it has none. `titles` names the ancestors the dialog knows.
 */
export function remainingAccess(
  who: string,
  principal: string,
  explanation: GrantExplanation,
  titles: ReadonlyMap<string, string>,
  labelOf: (principal: string) => string,
): string | null {
  if (explanation.role <= 0) return null
  const winner = explanation.rows.find((row) => row.winner)
  if (!winner) return `${who} still has access.`
  if (winner.principal !== principal) return `${who} still has access through ${labelOf(winner.principal)}.`
  const title = titles.get(winner.node)
  return title ? `${who} still has access from "${title}".` : `${who} still has access.`
}

/** The words for a principal nobody named: groups, the org, the public. */
export function principalLabel(principal: string, users: ReadonlyMap<string, string> = new Map()): string {
  switch (principalKind(principal)) {
    case 'general':
      return 'Everyone at the org'
    case 'public':
      return 'Public on the web'
    case 'group':
      return groupName(principal)
    case 'link':
      return 'Share link'
    case 'user':
      return users.get(principal) ?? principal
  }
}
