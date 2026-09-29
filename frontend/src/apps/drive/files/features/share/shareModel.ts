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
import { DRIVE_ROLES } from '@/apps/drive/client/types'

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
  /** No local row for this principal yet, so "Deny access here" applies. */
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
    // A deny needs no deny. Links cannot be denied from here, and a root has no
    // public access to deny.
    const deniable = entry.grant.role > 0 && kind !== 'link' && !(isRoot && kind === 'public') && !localPrincipals.has(entry.grant.principal)
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
  const row = local.find((candidate) => candidate.grant.principal === principal && !candidate.expired)
  if (row?.denied) return { state: 'denied', row }
  if (row) return { state: 'local', row }
  // `inherited` is nearest first, and the nearest live row decides.
  const nearest = inherited.find((entry) => entry.grant.principal === principal)
  if (nearest && nearest.grant.role > 0) return { state: 'inherited', entry: nearest }
  return { state: 'off' }
}

/** Removing or lowering the caller's own MANAGE row asks first (§7.4). */
export function losesOwnManage(row: LocalRow, me: string | undefined, nextRole: number | null): boolean {
  if (!me || row.kind !== 'user' || row.grant.principal !== me) return false
  if (row.grant.role < DRIVE_ROLES.manage) return false
  return nextRole === null || nextRole < DRIVE_ROLES.manage
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
