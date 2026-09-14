// Generated from src/apps/drive/client/contract.json. Do not edit.
import type { Operation } from '@/platform/transport'

export type NodeCreateInput = Record<string, never>

export type NodeCreateOutput = { "name": string; "title": string; "kind": string; "parent": (string) | (null); "root": string; "state": string; "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": string; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null) }

export type NodeCreateError = never

const operationNodeCreate: Operation<NodeCreateInput, NodeCreateOutput, NodeCreateError> = {
  id: "node_create",
  owner: "drive",
  method: "POST",
  path: "nodes",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeCreateInput { assertSchema(value, {"type":"object","properties":{},"required":[],"additionalProperties":false,"$defs":{}}, 'node_create input') },
  validateOutput(value): asserts value is NodeCreateOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"}},"required":["name","title"],"title":"BreadcrumbShape","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"title":"Owner","type":"string"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"}},"required":["name","title","kind","parent","root","state","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_create output') },
}

export type NodeBatchInput = { "nodes": Array<string>; "patch": { "title"?: string; "parent"?: string; "state"?: "Active" | "Trashed"; "content_modified"?: string } }

export type NodeBatchOutput = { "ok": Array<string>; "failed": Array<{ "node": string; "type": string; "message": string }> }

export type NodeBatchError = never

const operationNodeBatch: Operation<NodeBatchInput, NodeBatchOutput, NodeBatchError> = {
  id: "node_batch",
  owner: "drive",
  method: "POST",
  path: "nodes/batch",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeBatchInput { assertSchema(value, {"type":"object","properties":{"nodes":{"items":{"type":"string"},"title":"Nodes","type":"array"},"patch":{"$ref":"#/$defs/BatchPatch"}},"required":["nodes","patch"],"additionalProperties":false,"$defs":{"BatchPatch":{"properties":{"title":{"title":"Title","type":"string"},"parent":{"title":"Parent","type":"string"},"state":{"enum":["Active","Trashed"],"title":"State","type":"string"},"content_modified":{"title":"Content Modified","type":"string"}},"title":"BatchPatch","type":"object"}}}, 'node_batch input') },
  validateOutput(value): asserts value is NodeBatchOutput { assertSchema(value, {"$defs":{"BatchFailure":{"properties":{"node":{"title":"Node","type":"string"},"type":{"title":"Type","type":"string"},"message":{"title":"Message","type":"string"}},"required":["node","type","message"],"title":"BatchFailure","type":"object"}},"properties":{"ok":{"items":{"type":"string"},"title":"Ok","type":"array"},"failed":{"items":{"$ref":"#/$defs/BatchFailure"},"title":"Failed","type":"array"}},"required":["ok","failed"],"title":"BatchResult","type":"object"}, 'node_batch output') },
}

export type NodeGetInput = { "expand"?: string; "node": string }

export type NodeGetOutput = { "name": string; "title": string; "kind": string; "parent": (string) | (null); "root": string; "state": string; "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": string; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null) }

export type NodeGetError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired"

const operationNodeGet: Operation<NodeGetInput, NodeGetOutput, NodeGetError> = {
  id: "node_get",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: {"tag":"DriveNode","id":"name","version":"modified"},
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired"],
  validateInput(value): asserts value is NodeGetInput { assertSchema(value, {"type":"object","properties":{"expand":{"title":"Expand","type":"string"},"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_get input') },
  validateOutput(value): asserts value is NodeGetOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"}},"required":["name","title"],"title":"BreadcrumbShape","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"title":"Owner","type":"string"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"}},"required":["name","title","kind","parent","root","state","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_get output') },
}

export type NodePatchRenameInput = { "title": string; "node": string }

export type NodePatchRenameOutput = { "name": string; "title": string; "kind": string; "parent": (string) | (null); "root": string; "state": string; "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": string; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null) }

export type NodePatchRenameError = "DriveForbidden" | "DriveConflict" | "DriveOverQuota"

const operationNodePatchRename: Operation<NodePatchRenameInput, NodePatchRenameOutput, NodePatchRenameError> = {
  id: "node_patch.rename",
  owner: "drive",
  method: "PATCH",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: {"tag":"DriveNode","id":"name","version":"modified"},
  errors: ["DriveForbidden","DriveConflict","DriveOverQuota"],
  validateInput(value): asserts value is NodePatchRenameInput { assertSchema(value, {"type":"object","properties":{"title":{"title":"Title","type":"string"},"node":{"type":"string"}},"required":["title","node"],"additionalProperties":false,"$defs":{}}, 'node_patch.rename input') },
  validateOutput(value): asserts value is NodePatchRenameOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"}},"required":["name","title"],"title":"BreadcrumbShape","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"title":"Owner","type":"string"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"}},"required":["name","title","kind","parent","root","state","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_patch.rename output') },
}

export type NodePatchMoveInput = { "parent": string; "node": string }

export type NodePatchMoveOutput = { "name": string; "title": string; "kind": string; "parent": (string) | (null); "root": string; "state": string; "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": string; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null) }

export type NodePatchMoveError = "DriveForbidden" | "DriveConflict" | "DriveOverQuota"

const operationNodePatchMove: Operation<NodePatchMoveInput, NodePatchMoveOutput, NodePatchMoveError> = {
  id: "node_patch.move",
  owner: "drive",
  method: "PATCH",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: {"tag":"DriveNode","id":"name","version":"modified"},
  errors: ["DriveForbidden","DriveConflict","DriveOverQuota"],
  validateInput(value): asserts value is NodePatchMoveInput { assertSchema(value, {"type":"object","properties":{"parent":{"title":"Parent","type":"string"},"node":{"type":"string"}},"required":["parent","node"],"additionalProperties":false,"$defs":{}}, 'node_patch.move input') },
  validateOutput(value): asserts value is NodePatchMoveOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"}},"required":["name","title"],"title":"BreadcrumbShape","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"title":"Owner","type":"string"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"}},"required":["name","title","kind","parent","root","state","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_patch.move output') },
}

export type NodePatchTrashInput = { "state": "Trashed"; "node": string }

export type NodePatchTrashOutput = { "name": string; "title": string; "kind": string; "parent": (string) | (null); "root": string; "state": string; "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": string; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null) }

export type NodePatchTrashError = "DriveForbidden" | "DriveConflict" | "DriveOverQuota"

const operationNodePatchTrash: Operation<NodePatchTrashInput, NodePatchTrashOutput, NodePatchTrashError> = {
  id: "node_patch.trash",
  owner: "drive",
  method: "PATCH",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: {"tag":"DriveNode","id":"name","version":"modified"},
  errors: ["DriveForbidden","DriveConflict","DriveOverQuota"],
  validateInput(value): asserts value is NodePatchTrashInput { assertSchema(value, {"type":"object","properties":{"state":{"const":"Trashed","title":"State","type":"string"},"node":{"type":"string"}},"required":["state","node"],"additionalProperties":false,"$defs":{}}, 'node_patch.trash input') },
  validateOutput(value): asserts value is NodePatchTrashOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"}},"required":["name","title"],"title":"BreadcrumbShape","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"title":"Owner","type":"string"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"}},"required":["name","title","kind","parent","root","state","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_patch.trash output') },
}

export type NodePatchRestoreInput = { "state": "Active"; "parent"?: string; "node": string }

export type NodePatchRestoreOutput = { "name": string; "title": string; "kind": string; "parent": (string) | (null); "root": string; "state": string; "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": string; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null) }

export type NodePatchRestoreError = "DriveForbidden" | "DriveConflict" | "DriveOverQuota"

const operationNodePatchRestore: Operation<NodePatchRestoreInput, NodePatchRestoreOutput, NodePatchRestoreError> = {
  id: "node_patch.restore",
  owner: "drive",
  method: "PATCH",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: {"tag":"DriveNode","id":"name","version":"modified"},
  errors: ["DriveForbidden","DriveConflict","DriveOverQuota"],
  validateInput(value): asserts value is NodePatchRestoreInput { assertSchema(value, {"type":"object","properties":{"state":{"const":"Active","title":"State","type":"string"},"parent":{"title":"Parent","type":"string"},"node":{"type":"string"}},"required":["state","node"],"additionalProperties":false,"$defs":{}}, 'node_patch.restore input') },
  validateOutput(value): asserts value is NodePatchRestoreOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"}},"required":["name","title"],"title":"BreadcrumbShape","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"title":"Owner","type":"string"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"}},"required":["name","title","kind","parent","root","state","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_patch.restore output') },
}

export type NodePatchStampInput = { "content_modified": string; "node": string }

export type NodePatchStampOutput = { "name": string; "title": string; "kind": string; "parent": (string) | (null); "root": string; "state": string; "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": string; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null) }

export type NodePatchStampError = "DriveForbidden" | "DriveConflict" | "DriveOverQuota"

const operationNodePatchStamp: Operation<NodePatchStampInput, NodePatchStampOutput, NodePatchStampError> = {
  id: "node_patch.stamp",
  owner: "drive",
  method: "PATCH",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: {"tag":"DriveNode","id":"name","version":"modified"},
  errors: ["DriveForbidden","DriveConflict","DriveOverQuota"],
  validateInput(value): asserts value is NodePatchStampInput { assertSchema(value, {"type":"object","properties":{"content_modified":{"title":"Content Modified","type":"string"},"node":{"type":"string"}},"required":["content_modified","node"],"additionalProperties":false,"$defs":{}}, 'node_patch.stamp input') },
  validateOutput(value): asserts value is NodePatchStampOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"}},"required":["name","title"],"title":"BreadcrumbShape","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"title":"Owner","type":"string"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"}},"required":["name","title","kind","parent","root","state","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_patch.stamp output') },
}

export type NodePurgeInput = { "node": string }

export type NodePurgeOutput = {  }

export type NodePurgeError = never

const operationNodePurge: Operation<NodePurgeInput, NodePurgeOutput, NodePurgeError> = {
  id: "node_purge",
  owner: "drive",
  method: "DELETE",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodePurgeInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_purge input') },
  validateOutput(value): asserts value is NodePurgeOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_purge output') },
}

export type NodeChildrenInput = { "limit"?: number; "cursor"?: string; "order_by"?: string; "ascending"?: boolean; "mime_prefix"?: string; "kind"?: "folder"; "group_by"?: "type" | "owner" | "modified"; "expand"?: string; "node": string }

export type NodeChildrenOutput = { "rows": Array<{ "name": string; "title": string; "kind": string; "parent": (string) | (null); "root": string; "state": string; "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": string; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null) }>; "next_cursor": (string) | (null) }

export type NodeChildrenError = "DriveConflict"

const operationNodeChildren: Operation<NodeChildrenInput, NodeChildrenOutput, NodeChildrenError> = {
  id: "node_children",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/children",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveConflict"],
  validateInput(value): asserts value is NodeChildrenInput { assertSchema(value, {"type":"object","properties":{"limit":{"title":"Limit","type":"integer"},"cursor":{"title":"Cursor","type":"string"},"order_by":{"title":"Order By","type":"string"},"ascending":{"title":"Ascending","type":"boolean"},"mime_prefix":{"title":"Mime Prefix","type":"string"},"kind":{"const":"folder","title":"Kind","type":"string"},"group_by":{"enum":["type","owner","modified"],"title":"Group By","type":"string"},"expand":{"title":"Expand","type":"string"},"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_children input') },
  validateOutput(value): asserts value is NodeChildrenOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"}},"required":["name","title"],"title":"BreadcrumbShape","type":"object"},"NodeShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"title":"Owner","type":"string"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"}},"required":["name","title","kind","parent","root","state","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"rows":{"items":{"$ref":"#/$defs/NodeShape"},"title":"Rows","type":"array"},"next_cursor":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Next Cursor"}},"required":["rows","next_cursor"],"title":"Page","type":"object"}, 'node_children output') },
}

export type NodeCopyInput = { "parent": string; "title"?: string; "node": string }

export type NodeCopyOutput = { "name": string; "title": string; "kind": string; "parent": (string) | (null); "root": string; "state": string; "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": string; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null) }

export type NodeCopyError = "DriveForbidden" | "DriveConflict" | "DriveOverQuota"

const operationNodeCopy: Operation<NodeCopyInput, NodeCopyOutput, NodeCopyError> = {
  id: "node_copy",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/copy",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveForbidden","DriveConflict","DriveOverQuota"],
  validateInput(value): asserts value is NodeCopyInput { assertSchema(value, {"type":"object","properties":{"parent":{"title":"Parent","type":"string"},"title":{"title":"Title","type":"string"},"node":{"type":"string"}},"required":["parent","node"],"additionalProperties":false,"$defs":{}}, 'node_copy input') },
  validateOutput(value): asserts value is NodeCopyOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"}},"required":["name","title"],"title":"BreadcrumbShape","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"title":"Owner","type":"string"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"}},"required":["name","title","kind","parent","root","state","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_copy output') },
}

export type NodeArchiveStartInput = { "node": string }

export type NodeArchiveStartOutput = { "status": "building" | "ready" | "failed"; "file_name": (string) | (null); "size": (number) | (null); "error": (string) | (null) }

export type NodeArchiveStartError = "DriveConflict"

const operationNodeArchiveStart: Operation<NodeArchiveStartInput, NodeArchiveStartOutput, NodeArchiveStartError> = {
  id: "node_archive_start",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/archive",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveConflict"],
  validateInput(value): asserts value is NodeArchiveStartInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_archive_start input') },
  validateOutput(value): asserts value is NodeArchiveStartOutput { assertSchema(value, {"properties":{"status":{"enum":["building","ready","failed"],"title":"Status","type":"string"},"file_name":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"File Name"},"size":{"anyOf":[{"type":"integer"},{"type":"null"}],"title":"Size"},"error":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Error"}},"required":["status","file_name","size","error"],"title":"ArchiveStatus","type":"object"}, 'node_archive_start output') },
}

export type NodeArchiveStatusInput = { "node": string }

export type NodeArchiveStatusOutput = { "status": "building" | "ready" | "failed"; "file_name": (string) | (null); "size": (number) | (null); "error": (string) | (null) }

export type NodeArchiveStatusError = "DriveNotFound" | "DriveConflict"

const operationNodeArchiveStatus: Operation<NodeArchiveStatusInput, NodeArchiveStatusOutput, NodeArchiveStatusError> = {
  id: "node_archive_status",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/archive",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveConflict"],
  validateInput(value): asserts value is NodeArchiveStatusInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_archive_status input') },
  validateOutput(value): asserts value is NodeArchiveStatusOutput { assertSchema(value, {"properties":{"status":{"enum":["building","ready","failed"],"title":"Status","type":"string"},"file_name":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"File Name"},"size":{"anyOf":[{"type":"integer"},{"type":"null"}],"title":"Size"},"error":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Error"}},"required":["status","file_name","size","error"],"title":"ArchiveStatus","type":"object"}, 'node_archive_status output') },
}

export type NodeArchiveDownloadInput = { "node": string }

export type NodeArchiveDownloadOutput = unknown

export type NodeArchiveDownloadError = never

const operationNodeArchiveDownload: Operation<NodeArchiveDownloadInput, NodeArchiveDownloadOutput, NodeArchiveDownloadError> = {
  id: "node_archive_download",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/archive/download",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeArchiveDownloadInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_archive_download input') },
  validateOutput(value): asserts value is NodeArchiveDownloadOutput { assertSchema(value, {}, 'node_archive_download output') },
}

export type NodePutContentInput = { "node": string }

export type NodePutContentOutput = {  }

export type NodePutContentError = never

const operationNodePutContent: Operation<NodePutContentInput, NodePutContentOutput, NodePutContentError> = {
  id: "node_put_content",
  owner: "drive",
  method: "PUT",
  path: "nodes/{node}/content",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodePutContentInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_put_content input') },
  validateOutput(value): asserts value is NodePutContentOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_put_content output') },
}

export type NodeGetContentInput = { "node": string }

export type NodeGetContentOutput = unknown

export type NodeGetContentError = never

const operationNodeGetContent: Operation<NodeGetContentInput, NodeGetContentOutput, NodeGetContentError> = {
  id: "node_get_content",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/content",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeGetContentInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_get_content input') },
  validateOutput(value): asserts value is NodeGetContentOutput { assertSchema(value, {}, 'node_get_content output') },
}

export type NodeMediaInput = { "node": string }

export type NodeMediaOutput = {  }

export type NodeMediaError = never

const operationNodeMedia: Operation<NodeMediaInput, NodeMediaOutput, NodeMediaError> = {
  id: "node_media",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/media",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeMediaInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_media input') },
  validateOutput(value): asserts value is NodeMediaOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_media output') },
}

export type NodePreviewInput = { "node": string }

export type NodePreviewOutput = {  }

export type NodePreviewError = never

const operationNodePreview: Operation<NodePreviewInput, NodePreviewOutput, NodePreviewError> = {
  id: "node_preview",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/preview",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodePreviewInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_preview input') },
  validateOutput(value): asserts value is NodePreviewOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_preview output') },
}

export type UploadCreateInput = Record<string, never>

export type UploadCreateOutput = {  }

export type UploadCreateError = never

const operationUploadCreate: Operation<UploadCreateInput, UploadCreateOutput, UploadCreateError> = {
  id: "upload_create",
  owner: "drive",
  method: "POST",
  path: "uploads",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is UploadCreateInput { assertSchema(value, {"type":"object","properties":{},"required":[],"additionalProperties":false,"$defs":{}}, 'upload_create input') },
  validateOutput(value): asserts value is UploadCreateOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'upload_create output') },
}

export type UploadChunkInput = { "upload_id": string }

export type UploadChunkOutput = {  }

export type UploadChunkError = never

const operationUploadChunk: Operation<UploadChunkInput, UploadChunkOutput, UploadChunkError> = {
  id: "upload_chunk",
  owner: "drive",
  method: "PUT",
  path: "uploads/{upload_id}/chunk",
  prefix: "/api/suite/drive/",
  pathParams: ["upload_id"],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is UploadChunkInput { assertSchema(value, {"type":"object","properties":{"upload_id":{"type":"string"}},"required":["upload_id"],"additionalProperties":false,"$defs":{}}, 'upload_chunk input') },
  validateOutput(value): asserts value is UploadChunkOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'upload_chunk output') },
}

export type UploadFinishInput = { "upload_id": string }

export type UploadFinishOutput = {  }

export type UploadFinishError = never

const operationUploadFinish: Operation<UploadFinishInput, UploadFinishOutput, UploadFinishError> = {
  id: "upload_finish",
  owner: "drive",
  method: "POST",
  path: "uploads/{upload_id}/finish",
  prefix: "/api/suite/drive/",
  pathParams: ["upload_id"],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is UploadFinishInput { assertSchema(value, {"type":"object","properties":{"upload_id":{"type":"string"}},"required":["upload_id"],"additionalProperties":false,"$defs":{}}, 'upload_finish input') },
  validateOutput(value): asserts value is UploadFinishOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'upload_finish output') },
}

export type NodeActivityInput = { "node": string }

export type NodeActivityOutput = {  }

export type NodeActivityError = never

const operationNodeActivity: Operation<NodeActivityInput, NodeActivityOutput, NodeActivityError> = {
  id: "node_activity",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/activity",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeActivityInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_activity input') },
  validateOutput(value): asserts value is NodeActivityOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_activity output') },
}

export type NodeVisitInput = { "node": string }

export type NodeVisitOutput = {  }

export type NodeVisitError = never

const operationNodeVisit: Operation<NodeVisitInput, NodeVisitOutput, NodeVisitError> = {
  id: "node_visit",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/visit",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeVisitInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_visit input') },
  validateOutput(value): asserts value is NodeVisitOutput { assertSchema(value, {"properties":{},"title":"Empty","type":"object"}, 'node_visit output') },
}

export type NodePutFavouriteInput = { "node": string }

export type NodePutFavouriteOutput = {  }

export type NodePutFavouriteError = never

const operationNodePutFavourite: Operation<NodePutFavouriteInput, NodePutFavouriteOutput, NodePutFavouriteError> = {
  id: "node_put_favourite",
  owner: "drive",
  method: "PUT",
  path: "nodes/{node}/favourite",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodePutFavouriteInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_put_favourite input') },
  validateOutput(value): asserts value is NodePutFavouriteOutput { assertSchema(value, {"properties":{},"title":"Empty","type":"object"}, 'node_put_favourite output') },
}

export type NodeDeleteFavouriteInput = { "node": string }

export type NodeDeleteFavouriteOutput = {  }

export type NodeDeleteFavouriteError = never

const operationNodeDeleteFavourite: Operation<NodeDeleteFavouriteInput, NodeDeleteFavouriteOutput, NodeDeleteFavouriteError> = {
  id: "node_delete_favourite",
  owner: "drive",
  method: "DELETE",
  path: "nodes/{node}/favourite",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeDeleteFavouriteInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_delete_favourite input') },
  validateOutput(value): asserts value is NodeDeleteFavouriteOutput { assertSchema(value, {"properties":{},"title":"Empty","type":"object"}, 'node_delete_favourite output') },
}

export type NodeGrantsInput = { "node": string }

export type NodeGrantsOutput = {  }

export type NodeGrantsError = never

const operationNodeGrants: Operation<NodeGrantsInput, NodeGrantsOutput, NodeGrantsError> = {
  id: "node_grants",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/grants",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeGrantsInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_grants input') },
  validateOutput(value): asserts value is NodeGrantsOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_grants output') },
}

export type NodePutGrantInput = { "node": string; "principal": string }

export type NodePutGrantOutput = {  }

export type NodePutGrantError = never

const operationNodePutGrant: Operation<NodePutGrantInput, NodePutGrantOutput, NodePutGrantError> = {
  id: "node_put_grant",
  owner: "drive",
  method: "PUT",
  path: "nodes/{node}/grants/{principal:path}",
  prefix: "/api/suite/drive/",
  pathParams: ["node","principal"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodePutGrantInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"},"principal":{"type":"string"}},"required":["node","principal"],"additionalProperties":false,"$defs":{}}, 'node_put_grant input') },
  validateOutput(value): asserts value is NodePutGrantOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_put_grant output') },
}

export type NodeDeleteGrantInput = { "node": string; "principal": string }

export type NodeDeleteGrantOutput = {  }

export type NodeDeleteGrantError = never

const operationNodeDeleteGrant: Operation<NodeDeleteGrantInput, NodeDeleteGrantOutput, NodeDeleteGrantError> = {
  id: "node_delete_grant",
  owner: "drive",
  method: "DELETE",
  path: "nodes/{node}/grants/{principal:path}",
  prefix: "/api/suite/drive/",
  pathParams: ["node","principal"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeDeleteGrantInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"},"principal":{"type":"string"}},"required":["node","principal"],"additionalProperties":false,"$defs":{}}, 'node_delete_grant input') },
  validateOutput(value): asserts value is NodeDeleteGrantOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_delete_grant output') },
}

export type GrantRotateInput = { "grant": string }

export type GrantRotateOutput = {  }

export type GrantRotateError = never

const operationGrantRotate: Operation<GrantRotateInput, GrantRotateOutput, GrantRotateError> = {
  id: "grant_rotate",
  owner: "drive",
  method: "POST",
  path: "grants/{grant}/rotate",
  prefix: "/api/suite/drive/",
  pathParams: ["grant"],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is GrantRotateInput { assertSchema(value, {"type":"object","properties":{"grant":{"type":"string"}},"required":["grant"],"additionalProperties":false,"$defs":{}}, 'grant_rotate input') },
  validateOutput(value): asserts value is GrantRotateOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'grant_rotate output') },
}

export type LinkUnlockInput = { "token": string }

export type LinkUnlockOutput = {  }

export type LinkUnlockError = never

const operationLinkUnlock: Operation<LinkUnlockInput, LinkUnlockOutput, LinkUnlockError> = {
  id: "link_unlock",
  owner: "drive",
  method: "POST",
  path: "links/{token}/unlock",
  prefix: "/api/suite/drive/",
  pathParams: ["token"],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is LinkUnlockInput { assertSchema(value, {"type":"object","properties":{"token":{"type":"string"}},"required":["token"],"additionalProperties":false,"$defs":{}}, 'link_unlock input') },
  validateOutput(value): asserts value is LinkUnlockOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'link_unlock output') },
}

export type ViewClearRecentsInput = Record<string, never>

export type ViewClearRecentsOutput = {  }

export type ViewClearRecentsError = never

const operationViewClearRecents: Operation<ViewClearRecentsInput, ViewClearRecentsOutput, ViewClearRecentsError> = {
  id: "view_clear_recents",
  owner: "drive",
  method: "DELETE",
  path: "views/recents",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is ViewClearRecentsInput { assertSchema(value, {"type":"object","properties":{},"required":[],"additionalProperties":false,"$defs":{}}, 'view_clear_recents input') },
  validateOutput(value): asserts value is ViewClearRecentsOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'view_clear_recents output') },
}

export type ViewListInput = { "limit"?: number; "cursor"?: string; "root"?: string; "content_doctype"?: string; "term"?: string; "expand"?: string; "view": string }

export type ViewListOutput = { "rows": Array<({ "name": string; "title": string; "kind": string; "parent": (string) | (null); "root": string; "state": string; "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": string; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null) }) | ({ "root": string; "user": (string) | (null); "used_bytes": number; "quota_bytes": number })>; "next_cursor": (string) | (null) }

export type ViewListError = never

const operationViewList: Operation<ViewListInput, ViewListOutput, ViewListError> = {
  id: "view_list",
  owner: "drive",
  method: "GET",
  path: "views/{view}",
  prefix: "/api/suite/drive/",
  pathParams: ["view"],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is ViewListInput { assertSchema(value, {"type":"object","properties":{"limit":{"title":"Limit","type":"integer"},"cursor":{"title":"Cursor","type":"string"},"root":{"title":"Root","type":"string"},"content_doctype":{"title":"Content Doctype","type":"string"},"term":{"title":"Term","type":"string"},"expand":{"title":"Expand","type":"string"},"view":{"type":"string"}},"required":["view"],"additionalProperties":false,"$defs":{}}, 'view_list input') },
  validateOutput(value): asserts value is ViewListOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"ArchivedRootShape":{"properties":{"root":{"title":"Root","type":"string"},"user":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User"},"used_bytes":{"title":"Used Bytes","type":"integer"},"quota_bytes":{"title":"Quota Bytes","type":"integer"}},"required":["root","user","used_bytes","quota_bytes"],"title":"ArchivedRootShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"}},"required":["name","title"],"title":"BreadcrumbShape","type":"object"},"NodeShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"title":"Owner","type":"string"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"}},"required":["name","title","kind","parent","root","state","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"rows":{"items":{"anyOf":[{"$ref":"#/$defs/NodeShape"},{"$ref":"#/$defs/ArchivedRootShape"}]},"title":"Rows","type":"array"},"next_cursor":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Next Cursor"}},"required":["rows","next_cursor"],"title":"Page","type":"object"}, 'view_list output') },
}

export type NodeVersionsInput = { "node": string }

export type NodeVersionsOutput = {  }

export type NodeVersionsError = never

const operationNodeVersions: Operation<NodeVersionsInput, NodeVersionsOutput, NodeVersionsError> = {
  id: "node_versions",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/versions",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeVersionsInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_versions input') },
  validateOutput(value): asserts value is NodeVersionsOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_versions output') },
}

export type NodeVersionCreateInput = { "node": string }

export type NodeVersionCreateOutput = {  }

export type NodeVersionCreateError = never

const operationNodeVersionCreate: Operation<NodeVersionCreateInput, NodeVersionCreateOutput, NodeVersionCreateError> = {
  id: "node_version_create",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/versions",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeVersionCreateInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_version_create input') },
  validateOutput(value): asserts value is NodeVersionCreateOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_version_create output') },
}

export type NodeVersionPatchInput = { "node": string; "seq": string }

export type NodeVersionPatchOutput = {  }

export type NodeVersionPatchError = never

const operationNodeVersionPatch: Operation<NodeVersionPatchInput, NodeVersionPatchOutput, NodeVersionPatchError> = {
  id: "node_version_patch",
  owner: "drive",
  method: "PATCH",
  path: "nodes/{node}/versions/{seq}",
  prefix: "/api/suite/drive/",
  pathParams: ["node","seq"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeVersionPatchInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"},"seq":{"type":"string"}},"required":["node","seq"],"additionalProperties":false,"$defs":{}}, 'node_version_patch input') },
  validateOutput(value): asserts value is NodeVersionPatchOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_version_patch output') },
}

export type NodeVersionDeleteInput = { "node": string; "seq": string }

export type NodeVersionDeleteOutput = {  }

export type NodeVersionDeleteError = never

const operationNodeVersionDelete: Operation<NodeVersionDeleteInput, NodeVersionDeleteOutput, NodeVersionDeleteError> = {
  id: "node_version_delete",
  owner: "drive",
  method: "DELETE",
  path: "nodes/{node}/versions/{seq}",
  prefix: "/api/suite/drive/",
  pathParams: ["node","seq"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeVersionDeleteInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"},"seq":{"type":"string"}},"required":["node","seq"],"additionalProperties":false,"$defs":{}}, 'node_version_delete input') },
  validateOutput(value): asserts value is NodeVersionDeleteOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_version_delete output') },
}

export type NodeVersionContentInput = { "node": string; "seq": string }

export type NodeVersionContentOutput = unknown

export type NodeVersionContentError = never

const operationNodeVersionContent: Operation<NodeVersionContentInput, NodeVersionContentOutput, NodeVersionContentError> = {
  id: "node_version_content",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/versions/{seq}/content",
  prefix: "/api/suite/drive/",
  pathParams: ["node","seq"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeVersionContentInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"},"seq":{"type":"string"}},"required":["node","seq"],"additionalProperties":false,"$defs":{}}, 'node_version_content input') },
  validateOutput(value): asserts value is NodeVersionContentOutput { assertSchema(value, {}, 'node_version_content output') },
}

export type NodeVersionRestoreInput = { "node": string; "seq": string }

export type NodeVersionRestoreOutput = {  }

export type NodeVersionRestoreError = never

const operationNodeVersionRestore: Operation<NodeVersionRestoreInput, NodeVersionRestoreOutput, NodeVersionRestoreError> = {
  id: "node_version_restore",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/versions/{seq}/restore",
  prefix: "/api/suite/drive/",
  pathParams: ["node","seq"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeVersionRestoreInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"},"seq":{"type":"string"}},"required":["node","seq"],"additionalProperties":false,"$defs":{}}, 'node_version_restore input') },
  validateOutput(value): asserts value is NodeVersionRestoreOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_version_restore output') },
}

export type NodeThreadsInput = { "node": string }

export type NodeThreadsOutput = {  }

export type NodeThreadsError = never

const operationNodeThreads: Operation<NodeThreadsInput, NodeThreadsOutput, NodeThreadsError> = {
  id: "node_threads",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/threads",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeThreadsInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_threads input') },
  validateOutput(value): asserts value is NodeThreadsOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_threads output') },
}

export type NodeThreadCreateInput = { "node": string }

export type NodeThreadCreateOutput = {  }

export type NodeThreadCreateError = never

const operationNodeThreadCreate: Operation<NodeThreadCreateInput, NodeThreadCreateOutput, NodeThreadCreateError> = {
  id: "node_thread_create",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/threads",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeThreadCreateInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_thread_create input') },
  validateOutput(value): asserts value is NodeThreadCreateOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'node_thread_create output') },
}

export type ThreadPatchInput = { "thread": string }

export type ThreadPatchOutput = {  }

export type ThreadPatchError = never

const operationThreadPatch: Operation<ThreadPatchInput, ThreadPatchOutput, ThreadPatchError> = {
  id: "thread_patch",
  owner: "drive",
  method: "PATCH",
  path: "threads/{thread}",
  prefix: "/api/suite/drive/",
  pathParams: ["thread"],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is ThreadPatchInput { assertSchema(value, {"type":"object","properties":{"thread":{"type":"string"}},"required":["thread"],"additionalProperties":false,"$defs":{}}, 'thread_patch input') },
  validateOutput(value): asserts value is ThreadPatchOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'thread_patch output') },
}

export type ThreadCommentCreateInput = { "thread": string }

export type ThreadCommentCreateOutput = {  }

export type ThreadCommentCreateError = never

const operationThreadCommentCreate: Operation<ThreadCommentCreateInput, ThreadCommentCreateOutput, ThreadCommentCreateError> = {
  id: "thread_comment_create",
  owner: "drive",
  method: "POST",
  path: "threads/{thread}/comments",
  prefix: "/api/suite/drive/",
  pathParams: ["thread"],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is ThreadCommentCreateInput { assertSchema(value, {"type":"object","properties":{"thread":{"type":"string"}},"required":["thread"],"additionalProperties":false,"$defs":{}}, 'thread_comment_create input') },
  validateOutput(value): asserts value is ThreadCommentCreateOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'thread_comment_create output') },
}

export type CommentPatchInput = { "comment": string }

export type CommentPatchOutput = {  }

export type CommentPatchError = never

const operationCommentPatch: Operation<CommentPatchInput, CommentPatchOutput, CommentPatchError> = {
  id: "comment_patch",
  owner: "drive",
  method: "PATCH",
  path: "comments/{comment}",
  prefix: "/api/suite/drive/",
  pathParams: ["comment"],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is CommentPatchInput { assertSchema(value, {"type":"object","properties":{"comment":{"type":"string"}},"required":["comment"],"additionalProperties":false,"$defs":{}}, 'comment_patch input') },
  validateOutput(value): asserts value is CommentPatchOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'comment_patch output') },
}

export type CommentDeleteInput = { "comment": string }

export type CommentDeleteOutput = {  }

export type CommentDeleteError = never

const operationCommentDelete: Operation<CommentDeleteInput, CommentDeleteOutput, CommentDeleteError> = {
  id: "comment_delete",
  owner: "drive",
  method: "DELETE",
  path: "comments/{comment}",
  prefix: "/api/suite/drive/",
  pathParams: ["comment"],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is CommentDeleteInput { assertSchema(value, {"type":"object","properties":{"comment":{"type":"string"}},"required":["comment"],"additionalProperties":false,"$defs":{}}, 'comment_delete input') },
  validateOutput(value): asserts value is CommentDeleteOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'comment_delete output') },
}

export type NotificationsListInput = { "limit"?: number; "cursor"?: string; "unread"?: boolean }

export type NotificationsListOutput = { "rows": Array<{ "name": string; "read": number; "creation": (string) | (null); "activity": { "name": string; "node": string; "action": string; "actor": string; "at": (string) | (null); "via_link": (string) | (null); "client": (string) | (null); "detail": {  } } }>; "next_cursor": (string) | (null) }

export type NotificationsListError = never

const operationNotificationsList: Operation<NotificationsListInput, NotificationsListOutput, NotificationsListError> = {
  id: "notifications_list",
  owner: "drive",
  method: "GET",
  path: "notifications",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NotificationsListInput { assertSchema(value, {"type":"object","properties":{"limit":{"title":"Limit","type":"integer"},"cursor":{"title":"Cursor","type":"string"},"unread":{"title":"Unread","type":"boolean"}},"required":[],"additionalProperties":false,"$defs":{}}, 'notifications_list input') },
  validateOutput(value): asserts value is NotificationsListOutput { assertSchema(value, {"$defs":{"ActivityShape":{"properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"action":{"title":"Action","type":"string"},"actor":{"title":"Actor","type":"string"},"at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"At"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"client":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Client"},"detail":{"additionalProperties":true,"title":"Detail","type":"object"}},"required":["name","node","action","actor","at","via_link","client","detail"],"title":"ActivityShape","type":"object"},"NotificationShape":{"properties":{"name":{"title":"Name","type":"string"},"read":{"title":"Read","type":"integer"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"activity":{"$ref":"#/$defs/ActivityShape"}},"required":["name","read","creation","activity"],"title":"NotificationShape","type":"object"}},"properties":{"rows":{"items":{"$ref":"#/$defs/NotificationShape"},"title":"Rows","type":"array"},"next_cursor":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Next Cursor"}},"required":["rows","next_cursor"],"title":"Page","type":"object"}, 'notifications_list output') },
}

export type NotificationsUnreadCountInput = Record<string, never>

export type NotificationsUnreadCountOutput = { "unread": number }

export type NotificationsUnreadCountError = never

const operationNotificationsUnreadCount: Operation<NotificationsUnreadCountInput, NotificationsUnreadCountOutput, NotificationsUnreadCountError> = {
  id: "notifications_unread_count",
  owner: "drive",
  method: "GET",
  path: "notifications/unread-count",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NotificationsUnreadCountInput { assertSchema(value, {"type":"object","properties":{},"required":[],"additionalProperties":false,"$defs":{}}, 'notifications_unread_count input') },
  validateOutput(value): asserts value is NotificationsUnreadCountOutput { assertSchema(value, {"properties":{"unread":{"title":"Unread","type":"integer"}},"required":["unread"],"title":"UnreadCount","type":"object"}, 'notifications_unread_count output') },
}

export type NotificationsReadNotificationNamesInput = { "notifications": Array<string> }

export type NotificationsReadNotificationNamesOutput = { "read": number }

export type NotificationsReadNotificationNamesError = never

const operationNotificationsReadNotificationNames: Operation<NotificationsReadNotificationNamesInput, NotificationsReadNotificationNamesOutput, NotificationsReadNotificationNamesError> = {
  id: "notifications_read.notification_names",
  owner: "drive",
  method: "POST",
  path: "notifications/read",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NotificationsReadNotificationNamesInput { assertSchema(value, {"type":"object","properties":{"notifications":{"items":{"type":"string"},"title":"Notifications","type":"array"}},"required":["notifications"],"additionalProperties":false,"$defs":{}}, 'notifications_read.notification_names input') },
  validateOutput(value): asserts value is NotificationsReadNotificationNamesOutput { assertSchema(value, {"properties":{"read":{"title":"Read","type":"integer"}},"required":["read"],"title":"ReadResult","type":"object"}, 'notifications_read.notification_names output') },
}

export type NotificationsReadAllNotificationsInput = { "all": true }

export type NotificationsReadAllNotificationsOutput = { "read": number }

export type NotificationsReadAllNotificationsError = never

const operationNotificationsReadAllNotifications: Operation<NotificationsReadAllNotificationsInput, NotificationsReadAllNotificationsOutput, NotificationsReadAllNotificationsError> = {
  id: "notifications_read.all_notifications",
  owner: "drive",
  method: "POST",
  path: "notifications/read",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NotificationsReadAllNotificationsInput { assertSchema(value, {"type":"object","properties":{"all":{"const":true,"title":"All","type":"boolean"}},"required":["all"],"additionalProperties":false,"$defs":{}}, 'notifications_read.all_notifications input') },
  validateOutput(value): asserts value is NotificationsReadAllNotificationsOutput { assertSchema(value, {"properties":{"read":{"title":"Read","type":"integer"}},"required":["read"],"title":"ReadResult","type":"object"}, 'notifications_read.all_notifications output') },
}

export type RootsDiscoverInput = Record<string, never>

export type RootsDiscoverOutput = { "personal": { "node": string; "title": string }; "organization": ({ "node": string; "title": string }) | (null) }

export type RootsDiscoverError = never

const operationRootsDiscover: Operation<RootsDiscoverInput, RootsDiscoverOutput, RootsDiscoverError> = {
  id: "roots_discover",
  owner: "drive",
  method: "GET",
  path: "roots",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RootsDiscoverInput { assertSchema(value, {"type":"object","properties":{},"required":[],"additionalProperties":false,"$defs":{}}, 'roots_discover input') },
  validateOutput(value): asserts value is RootsDiscoverOutput { assertSchema(value, {"$defs":{"RootLocation":{"properties":{"node":{"title":"Node","type":"string"},"title":{"title":"Title","type":"string"}},"required":["node","title"],"title":"RootLocation","type":"object"}},"properties":{"personal":{"$ref":"#/$defs/RootLocation"},"organization":{"anyOf":[{"$ref":"#/$defs/RootLocation"},{"type":"null"}]}},"required":["personal","organization"],"title":"RootLocations","type":"object"}, 'roots_discover output') },
}

export type RootUsageInput = { "root": string }

export type RootUsageOutput = { "used_bytes": number; "reserved_bytes": number; "quota_bytes": (number) | (null); "effective_quota": number }

export type RootUsageError = never

const operationRootUsage: Operation<RootUsageInput, RootUsageOutput, RootUsageError> = {
  id: "root_usage",
  owner: "drive",
  method: "GET",
  path: "roots/{root}/usage",
  prefix: "/api/suite/drive/",
  pathParams: ["root"],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RootUsageInput { assertSchema(value, {"type":"object","properties":{"root":{"type":"string"}},"required":["root"],"additionalProperties":false,"$defs":{}}, 'root_usage input') },
  validateOutput(value): asserts value is RootUsageOutput { assertSchema(value, {"properties":{"used_bytes":{"title":"Used Bytes","type":"integer"},"reserved_bytes":{"title":"Reserved Bytes","type":"integer"},"quota_bytes":{"anyOf":[{"type":"integer"},{"type":"null"}],"title":"Quota Bytes"},"effective_quota":{"title":"Effective Quota","type":"integer"}},"required":["used_bytes","reserved_bytes","quota_bytes","effective_quota"],"title":"RootUsage","type":"object"}, 'root_usage output') },
}

export type RootPatchInput = { "root": string }

export type RootPatchOutput = {  }

export type RootPatchError = never

const operationRootPatch: Operation<RootPatchInput, RootPatchOutput, RootPatchError> = {
  id: "root_patch",
  owner: "drive",
  method: "PATCH",
  path: "roots/{root}",
  prefix: "/api/suite/drive/",
  pathParams: ["root"],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RootPatchInput { assertSchema(value, {"type":"object","properties":{"root":{"type":"string"}},"required":["root"],"additionalProperties":false,"$defs":{}}, 'root_patch input') },
  validateOutput(value): asserts value is RootPatchOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'root_patch output') },
}

export type RootPurgeInput = { "root": string }

export type RootPurgeOutput = {  }

export type RootPurgeError = never

const operationRootPurge: Operation<RootPurgeInput, RootPurgeOutput, RootPurgeError> = {
  id: "root_purge",
  owner: "drive",
  method: "DELETE",
  path: "roots/{root}",
  prefix: "/api/suite/drive/",
  pathParams: ["root"],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is RootPurgeInput { assertSchema(value, {"type":"object","properties":{"root":{"type":"string"}},"required":["root"],"additionalProperties":false,"$defs":{}}, 'root_purge input') },
  validateOutput(value): asserts value is RootPurgeOutput { assertSchema(value, {"additionalProperties":true,"type":"object"}, 'root_purge output') },
}

export const api = {
  "node_create": operationNodeCreate,
  "node_batch": operationNodeBatch,
  "node_get": operationNodeGet,
  "node_patch": {
    "rename": operationNodePatchRename,
    "move": operationNodePatchMove,
    "trash": operationNodePatchTrash,
    "restore": operationNodePatchRestore,
    "stamp": operationNodePatchStamp
  },
  "node_purge": operationNodePurge,
  "node_children": operationNodeChildren,
  "node_copy": operationNodeCopy,
  "node_archive_start": operationNodeArchiveStart,
  "node_archive_status": operationNodeArchiveStatus,
  "node_archive_download": operationNodeArchiveDownload,
  "node_put_content": operationNodePutContent,
  "node_get_content": operationNodeGetContent,
  "node_media": operationNodeMedia,
  "node_preview": operationNodePreview,
  "upload_create": operationUploadCreate,
  "upload_chunk": operationUploadChunk,
  "upload_finish": operationUploadFinish,
  "node_activity": operationNodeActivity,
  "node_visit": operationNodeVisit,
  "node_put_favourite": operationNodePutFavourite,
  "node_delete_favourite": operationNodeDeleteFavourite,
  "node_grants": operationNodeGrants,
  "node_put_grant": operationNodePutGrant,
  "node_delete_grant": operationNodeDeleteGrant,
  "grant_rotate": operationGrantRotate,
  "link_unlock": operationLinkUnlock,
  "view_clear_recents": operationViewClearRecents,
  "view_list": operationViewList,
  "node_versions": operationNodeVersions,
  "node_version_create": operationNodeVersionCreate,
  "node_version_patch": operationNodeVersionPatch,
  "node_version_delete": operationNodeVersionDelete,
  "node_version_content": operationNodeVersionContent,
  "node_version_restore": operationNodeVersionRestore,
  "node_threads": operationNodeThreads,
  "node_thread_create": operationNodeThreadCreate,
  "thread_patch": operationThreadPatch,
  "thread_comment_create": operationThreadCommentCreate,
  "comment_patch": operationCommentPatch,
  "comment_delete": operationCommentDelete,
  "notifications_list": operationNotificationsList,
  "notifications_unread_count": operationNotificationsUnreadCount,
  "notifications_read": {
    "notification_names": operationNotificationsReadNotificationNames,
    "all_notifications": operationNotificationsReadAllNotifications
  },
  "roots_discover": operationRootsDiscover,
  "root_usage": operationRootUsage,
  "root_patch": operationRootPatch,
  "root_purge": operationRootPurge
} as const

function assertSchema(value: unknown, schema: any, label: string, root: any = schema): void {
  if (!schema || Object.keys(schema).length === 0) return
  if (schema.$ref) return assertSchema(value, resolveRef(root, schema.$ref), label, root)
  if (schema.const !== undefined && value !== schema.const) throw new TypeError(label + ' must equal ' + JSON.stringify(schema.const))
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new TypeError(label + ' is not an allowed value')
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((part: any) => valid(value, part, root))) throw new TypeError(label + ' does not match any allowed shape')
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter((part: any) => valid(value, part, root)).length !== 1) throw new TypeError(label + ' must match exactly one shape')
  if (Array.isArray(schema.allOf)) for (const part of schema.allOf) assertSchema(value, part, label, root)
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length && !types.some((type: string) => matchesType(value, type))) throw new TypeError(label + ' has the wrong type')
  if ((types.includes('object') || schema.properties) && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (!(key in record)) throw new TypeError(label + '.' + key + ' is required')
    if (schema.additionalProperties === false) for (const key of Object.keys(record)) if (!(key in (schema.properties ?? {}))) throw new TypeError(label + '.' + key + ' is not allowed')
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in record) assertSchema(record[key], child, label + '.' + key, root)
  }
  if ((types.includes('array') || schema.items) && Array.isArray(value)) value.forEach((item, index) => assertSchema(item, schema.items ?? {}, label + '[' + index + ']', root))
}

function valid(value: unknown, schema: any, root: any): boolean {
  try { assertSchema(value, schema, 'value', root); return true } catch { return false }
}

function resolveRef(root: any, ref: string): any {
  if (!ref.startsWith('#/')) throw new TypeError('Only local JSON schema references are supported')
  return ref.slice(2).split('/').reduce((value, part) => value?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], root)
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  return typeof value === type
}
