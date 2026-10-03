export const DRIVE_NODE_TAG = 'DriveNode'

/** A `?type=` value that keeps one type of node in a listing (`nodes.LISTING_TYPES`). */
export type DriveListingType = 'folder' | 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'image' | 'video' | 'audio'

/** The `?type=` argument for a listing that keeps any of `types`: a comma-separated list, or none. */
export function listingTypesParam(types: readonly DriveListingType[] | undefined): string | undefined {
  return types?.length ? types.join(',') : undefined
}

export const DRIVE_ROLES = {
  read: 10,
  comment: 20,
  upload: 30,
  edit: 40,
  manage: 50,
} as const

export interface DriveAccess {
  role?: number
  via_link?: string | null
  source_node?: string | null
  source_principal?: string | null
}

export interface DriveBreadcrumb {
  name: string
  title: string
}

export interface DrivePreview {
  url: string
  expires: number
}

/** A user as Drive publishes them wherever a row names one (Drive spec §11.3). */
export interface DrivePerson {
  /** The `User` id, the value a grant principal carries. */
  id: string
  /** The id itself when the user is gone. */
  full_name: string
  user_image: string | null
}

export interface DriveNode {
  name: string
  title: string
  kind: string
  parent_node: string | null
  root: string
  state: string
  /** The node whose trashing trashed this one: its own name on a trash root, null while Active. */
  trash_root: string | null
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: DrivePerson
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: DriveAccess
  breadcrumbs?: DriveBreadcrumb[]
  preview?: DrivePreview | null
  opened_at?: string | null
  favourite?: boolean
}

export interface DrivePage<Row = DriveNode> {
  rows: Row[]
  next_cursor: string | null
}

export interface DriveFailure {
  node: string
  type: string
  message: string
}

export interface DriveBatchResult {
  ok: string[]
  failed: DriveFailure[]
}

export interface DriveRoots {
  personal: { node: string; title: string }
  organization: { node: string; title: string } | null
}

export function hasRole(node: Pick<DriveNode, 'access'> | null | undefined, role: number): boolean {
  return (node?.access?.role ?? 0) >= role
}

