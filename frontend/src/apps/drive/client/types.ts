export const DRIVE_NODE_TAG = 'DriveNode'

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

export interface DriveNode {
  name: string
  title: string
  kind: string
  parent: string | null
  root: string
  state: string
  size: number
  mime: string | null
  url: string | null
  content_doctype: string | null
  content_docname: string | null
  is_template: number
  owner: string
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

