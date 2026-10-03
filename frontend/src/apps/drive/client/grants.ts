import { transport as defaultTransport, type Transport } from '@/platform/transport'

import { api } from './generated'
import { driveOperation } from './operation'
import { DRIVE_ROLES, type DrivePerson } from './types'

/**
 * Drive grants as the share dialog reads and writes them (Drive spec §11.2).
 *
 * A principal is one of five spellings (Drive spec §4.4): a user's email,
 * `$GROUP:<name>`, `$GENERAL` (everyone at the org), `$PUBLIC` (public on the
 * web) and `$LINK:<token>`. Role 0 is an explicit deny.
 *
 * A user, group or general row is written by its principal under the node
 * (`PUT /nodes/{node}/grants/{principal}`). A link's token never travels in a
 * path, so an existing link is rewritten and removed by its grant id
 * (`PATCH`/`DELETE /grants/{grant}`).
 */

export const GENERAL = '$GENERAL'
export const PUBLIC = '$PUBLIC'
export const NEW_LINK = '$LINK'
const GROUP_PREFIX = '$GROUP:'
const LINK_PREFIX = '$LINK'

export type PrincipalKind = 'user' | 'group' | 'general' | 'public' | 'link'

export interface DriveGrant {
  node: string
  principal: string
  /** 0 is an explicit deny. */
  role: number
  /** `YYYY-MM-DD HH:MM:SS`, or `null` for no expiry. */
  expires_on: string | null
  has_password: boolean
  /** Absent on a redacted inherited link. */
  name?: string
  /** The user a user principal names, with their name and avatar. */
  person?: DrivePerson
  sent_to?: string | null
  /** `/l/<token>`, on a link grant. */
  url?: string
}

export interface InheritedGrant {
  grant: DriveGrant
  /** A link on an ancestor the caller does not manage: no name, URL or recipient. */
  redacted: boolean
  source_node: string
  source_title: string
}

export interface GrantList {
  /** The node's own rows, expired ones included. */
  grants: DriveGrant[]
  /** Live grants on ancestors, nearest ancestor first. */
  inherited: InheritedGrant[]
  /** The user whose Personal root holds the node: their access cannot be denied. `null` in the Shared root. */
  owner: DrivePerson | null
}

export interface ExplainRow {
  node: string
  depth: number
  principal: string
  role: number
  expires_on: string | null
  /** 1: the subject's own principals (user, groups, org). 2: open ones (public, links). */
  pass: number
  held: boolean
  winner: boolean
}

export interface GrantExplanation {
  role: number
  source: string
  rows: ExplainRow[]
}

/**
 * One grant write. `role` and `expires_on` replace the stored values, so a
 * write that keeps an expiry sends it again. An omitted `password` keeps the
 * stored one, `null` clears it.
 */
export interface GrantWrite {
  role: number
  expires_on?: string | null
  password?: string | null
  /** On a new link: mint it for this one address and email it. */
  send_to?: string
  /** On a user: email them as well as the in-app notification. */
  notify?: boolean
}

/** A rewrite of one existing grant by its id. The same fields as `GrantWrite`, less the mailing options. */
export type GrantPatch = Pick<GrantWrite, 'role' | 'expires_on' | 'password'>

export interface Role {
  value: number
  label: string
}

const ROLE_LABELS: Record<number, string> = {
  [DRIVE_ROLES.read]: 'View',
  [DRIVE_ROLES.comment]: 'Comment',
  [DRIVE_ROLES.upload]: 'Upload',
  [DRIVE_ROLES.edit]: 'Edit',
  [DRIVE_ROLES.manage]: 'Manage',
}

export function roleLabel(role: number): string {
  return ROLE_LABELS[role] ?? (role <= 0 ? 'No access' : `Role ${role}`)
}

export function principalKind(principal: string): PrincipalKind {
  if (principal === GENERAL) return 'general'
  if (principal === PUBLIC) return 'public'
  if (principal.startsWith(GROUP_PREFIX)) return 'group'
  if (principal.startsWith(LINK_PREFIX)) return 'link'
  return 'user'
}

export function groupPrincipal(group: string): string {
  return `${GROUP_PREFIX}${group}`
}

export function groupName(principal: string): string {
  return principal.slice(GROUP_PREFIX.length)
}

/** Upload gives nothing on a file or document (Drive spec §4.2). */
function holdsChildren(nodeKind: string): boolean {
  return nodeKind === 'folder' || nodeKind === 'root'
}

/** The roles the dialog offers each principal (unified spec §7.5). Off is not a role. */
export function rolesFor(kind: PrincipalKind, nodeKind: string): Role[] {
  const ceiling = {
    user: DRIVE_ROLES.manage,
    group: DRIVE_ROLES.manage,
    general: DRIVE_ROLES.edit,
    link: DRIVE_ROLES.edit,
    public: DRIVE_ROLES.read,
  }[kind]
  return Object.values(DRIVE_ROLES)
    .filter((role) => role <= ceiling)
    .filter((role) => role !== DRIVE_ROLES.upload || holdsChildren(nodeKind))
    .map((value) => ({ value, label: roleLabel(value) }))
}

/** An expired grant is inert but stays listed (Drive spec §6.4). */
export function isExpired(grant: Pick<DriveGrant, 'expires_on'>, now = new Date()): boolean {
  if (!grant.expires_on) return false
  return parseStamp(grant.expires_on).getTime() <= now.getTime()
}

/** A server stamp: RFC 3339 in UTC (`2026-10-03T06:30:00Z`, Drive spec §11.3). */
export function parseStamp(stamp: string): Date {
  return new Date(stamp)
}

/**
 * Access ends at the end of the chosen day in the sharer's own zone (unified
 * spec §7.9), sent as the UTC instant the server requires (Drive spec §11.3).
 */
export function endOfDayStamp(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, day, 23, 59, 59).toISOString().replace('.000Z', 'Z')
}

const listOperation = driveOperation<{ node: string; inherited: true }, GrantList>(api.node_grants)
const explainOperation = driveOperation<
  { node: string; principal: string },
  { explain: GrantExplanation }
>(api.node_grants)
const putOperation = driveOperation<{ node: string; principal: string } & GrantWrite, DriveGrant>(
  api.node_put_grant,
)
const deleteOperation = driveOperation<
  { node: string; principal: string; below?: true },
  { count: number }
>(api.node_delete_grant)
// The grant routes name a grant, not a node, so they carry the node's link codes themselves.
const patchOperation = (node: string) =>
  driveOperation<{ grant: string } & GrantPatch, DriveGrant>(api.grant_patch, { covers: [node] })
const removeOperation = (node: string) =>
  driveOperation<{ grant: string }, { count: number }>(api.grant_delete, { covers: [node] })
const rotateOperation = (node: string) =>
  driveOperation<{ grant: string }, DriveGrant>(api.grant_rotate, { covers: [node] })

/** The grant calls of one node. Every call needs MANAGE on it. */
export function nodeGrants(node: string, transport: Transport = defaultTransport) {
  return {
    async list(): Promise<GrantList> {
      const answer = await transport.request(listOperation, { node, inherited: true })
      return {
        grants: answer.grants ?? [],
        inherited: answer.inherited ?? [],
        owner: answer.owner ?? null,
      }
    },
    async explain(principal: string): Promise<GrantExplanation> {
      return (await transport.request(explainOperation, { node, principal })).explain
    },
    /** Writes the row of a principal: a user, a group, the org or the public, or `$LINK` for a new link. */
    put(principal: string, write: GrantWrite): Promise<DriveGrant> {
      return transport.request(putOperation, { node, principal, ...write })
    },
    /** Removes a principal's local row. `below` also removes it from every item inside; the answer counts them all. */
    async remove(principal: string, below = false): Promise<number> {
      const answer = await transport.request(deleteOperation, {
        node,
        principal,
        ...(below ? { below: true as const } : {}),
      })
      return answer.count
    },
    /** Rewrites one existing row by its id: the way to change a link. */
    patch(grant: string, write: GrantPatch): Promise<DriveGrant> {
      return transport.request(patchOperation(node), { grant, ...write })
    },
    /** Removes one existing row by its id: the way to remove a link. */
    async removeGrant(grant: string): Promise<number> {
      return (await transport.request(removeOperation(node), { grant })).count
    },
    rotate(grant: string): Promise<DriveGrant> {
      return transport.request(rotateOperation(node), { grant })
    },
  }
}

export type NodeGrants = ReturnType<typeof nodeGrants>
