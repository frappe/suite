// Generated from src/apps/drive/client/contract.json. Do not edit.
import type { Operation } from '@/platform/transport'

export type NodeCreateCreateFolderInput = { "kind": "folder"; "parent_node": string; "title": string }

export type NodeCreateCreateFolderOutput = { "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }

export type NodeCreateCreateFolderError = "DriveForbidden" | "DriveConflict" | "DriveOverQuota"

const operationNodeCreateCreateFolder: Operation<NodeCreateCreateFolderInput, NodeCreateCreateFolderOutput, NodeCreateCreateFolderError> = {
  id: "node_create.create_folder",
  owner: "drive",
  method: "POST",
  path: "nodes",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["DriveForbidden","DriveConflict","DriveOverQuota"],
  validateInput(value): asserts value is NodeCreateCreateFolderInput { assertSchema(value, {"type":"object","properties":{"kind":{"const":"folder","title":"Kind","type":"string"},"parent_node":{"title":"Parent Node","type":"string"},"title":{"title":"Title","type":"string"}},"required":["kind","parent_node","title"],"additionalProperties":false,"$defs":{}}, 'node_create.create_folder input') },
  validateOutput(value): asserts value is NodeCreateCreateFolderOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_create.create_folder output') },
}

export type NodeCreateCreateFileInput = { "kind": "file"; "parent_node": string; "title": string; "blob": string; "size": number; "mime": string; "content_modified"?: string }

export type NodeCreateCreateFileOutput = { "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }

export type NodeCreateCreateFileError = "DriveForbidden" | "DriveConflict" | "DriveOverQuota"

const operationNodeCreateCreateFile: Operation<NodeCreateCreateFileInput, NodeCreateCreateFileOutput, NodeCreateCreateFileError> = {
  id: "node_create.create_file",
  owner: "drive",
  method: "POST",
  path: "nodes",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["DriveForbidden","DriveConflict","DriveOverQuota"],
  validateInput(value): asserts value is NodeCreateCreateFileInput { assertSchema(value, {"type":"object","properties":{"kind":{"const":"file","title":"Kind","type":"string"},"parent_node":{"title":"Parent Node","type":"string"},"title":{"title":"Title","type":"string"},"blob":{"title":"Blob","type":"string"},"size":{"title":"Size","type":"integer"},"mime":{"title":"Mime","type":"string"},"content_modified":{"title":"Content Modified","type":"string"}},"required":["kind","parent_node","title","blob","size","mime"],"additionalProperties":false,"$defs":{}}, 'node_create.create_file input') },
  validateOutput(value): asserts value is NodeCreateCreateFileOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_create.create_file output') },
}

export type NodeCreateCreateLinkInput = { "kind": "link"; "parent_node": string; "title": string; "url": string }

export type NodeCreateCreateLinkOutput = { "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }

export type NodeCreateCreateLinkError = "DriveForbidden" | "DriveConflict" | "DriveOverQuota"

const operationNodeCreateCreateLink: Operation<NodeCreateCreateLinkInput, NodeCreateCreateLinkOutput, NodeCreateCreateLinkError> = {
  id: "node_create.create_link",
  owner: "drive",
  method: "POST",
  path: "nodes",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["DriveForbidden","DriveConflict","DriveOverQuota"],
  validateInput(value): asserts value is NodeCreateCreateLinkInput { assertSchema(value, {"type":"object","properties":{"kind":{"const":"link","title":"Kind","type":"string"},"parent_node":{"title":"Parent Node","type":"string"},"title":{"title":"Title","type":"string"},"url":{"title":"Url","type":"string"}},"required":["kind","parent_node","title","url"],"additionalProperties":false,"$defs":{}}, 'node_create.create_link input') },
  validateOutput(value): asserts value is NodeCreateCreateLinkOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_create.create_link output') },
}

export type NodeCreateCreateDocumentInput = { "kind": "document"; "parent_node": string; "title": string; "content_doctype": string; "from_node"?: string; "is_template"?: boolean }

export type NodeCreateCreateDocumentOutput = { "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }

export type NodeCreateCreateDocumentError = "DriveForbidden" | "DriveConflict" | "DriveOverQuota"

const operationNodeCreateCreateDocument: Operation<NodeCreateCreateDocumentInput, NodeCreateCreateDocumentOutput, NodeCreateCreateDocumentError> = {
  id: "node_create.create_document",
  owner: "drive",
  method: "POST",
  path: "nodes",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["DriveForbidden","DriveConflict","DriveOverQuota"],
  validateInput(value): asserts value is NodeCreateCreateDocumentInput { assertSchema(value, {"type":"object","properties":{"kind":{"const":"document","title":"Kind","type":"string"},"parent_node":{"title":"Parent Node","type":"string"},"title":{"title":"Title","type":"string"},"content_doctype":{"title":"Content Doctype","type":"string"},"from_node":{"title":"From Node","type":"string"},"is_template":{"title":"Is Template","type":"boolean"}},"required":["kind","parent_node","title","content_doctype"],"additionalProperties":false,"$defs":{}}, 'node_create.create_document input') },
  validateOutput(value): asserts value is NodeCreateCreateDocumentOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_create.create_document output') },
}

export type NodeBatchInput = { "nodes": Array<string>; "patch": { "title"?: string; "parent_node"?: string; "expect_parent_node"?: string; "state"?: "Active" | "Trashed"; "content_modified"?: string } }

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
  validateInput(value): asserts value is NodeBatchInput { assertSchema(value, {"type":"object","properties":{"nodes":{"items":{"type":"string"},"title":"Nodes","type":"array"},"patch":{"$ref":"#/$defs/BatchPatch"}},"required":["nodes","patch"],"additionalProperties":false,"$defs":{"BatchPatch":{"properties":{"title":{"title":"Title","type":"string"},"parent_node":{"title":"Parent Node","type":"string"},"expect_parent_node":{"title":"Expect Parent Node","type":"string"},"state":{"enum":["Active","Trashed"],"title":"State","type":"string"},"content_modified":{"title":"Content Modified","type":"string"}},"title":"BatchPatch","type":"object"}}}, 'node_batch input') },
  validateOutput(value): asserts value is NodeBatchOutput { assertSchema(value, {"$defs":{"BatchFailure":{"properties":{"node":{"title":"Node","type":"string"},"type":{"title":"Type","type":"string"},"message":{"title":"Message","type":"string"}},"required":["node","type","message"],"title":"BatchFailure","type":"object"}},"properties":{"ok":{"items":{"type":"string"},"title":"Ok","type":"array"},"failed":{"items":{"$ref":"#/$defs/BatchFailure"},"title":"Failed","type":"array"}},"required":["ok","failed"],"title":"BatchResult","type":"object"}, 'node_batch output') },
}

export type NodeBatchPurgeInput = { "nodes": Array<string> }

export type NodeBatchPurgeOutput = { "ok": Array<string>; "failed": Array<{ "node": string; "type": string; "message": string }> }

export type NodeBatchPurgeError = never

const operationNodeBatchPurge: Operation<NodeBatchPurgeInput, NodeBatchPurgeOutput, NodeBatchPurgeError> = {
  id: "node_batch_purge",
  owner: "drive",
  method: "POST",
  path: "nodes/batch/purge",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is NodeBatchPurgeInput { assertSchema(value, {"type":"object","properties":{"nodes":{"items":{"type":"string"},"title":"Nodes","type":"array"}},"required":["nodes"],"additionalProperties":false,"$defs":{}}, 'node_batch_purge input') },
  validateOutput(value): asserts value is NodeBatchPurgeOutput { assertSchema(value, {"$defs":{"BatchFailure":{"properties":{"node":{"title":"Node","type":"string"},"type":{"title":"Type","type":"string"},"message":{"title":"Message","type":"string"}},"required":["node","type","message"],"title":"BatchFailure","type":"object"}},"properties":{"ok":{"items":{"type":"string"},"title":"Ok","type":"array"},"failed":{"items":{"$ref":"#/$defs/BatchFailure"},"title":"Failed","type":"array"}},"required":["ok","failed"],"title":"BatchResult","type":"object"}, 'node_batch_purge output') },
}

export type NodeGetInput = { "expand"?: string; "node": string }

export type NodeGetOutput = { "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }

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
  validateOutput(value): asserts value is NodeGetOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_get output') },
}

export type NodePatchRenameInput = { "title": string; "node": string }

export type NodePatchRenameOutput = { "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }

export type NodePatchRenameError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict" | "DriveMoved" | "DriveRestoreDestinationRequired" | "DriveOverQuota"

const operationNodePatchRename: Operation<NodePatchRenameInput, NodePatchRenameOutput, NodePatchRenameError> = {
  id: "node_patch.rename",
  owner: "drive",
  method: "PATCH",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: {"tag":"DriveNode","id":"name","version":"modified"},
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict","DriveMoved","DriveRestoreDestinationRequired","DriveOverQuota"],
  validateInput(value): asserts value is NodePatchRenameInput { assertSchema(value, {"type":"object","properties":{"title":{"title":"Title","type":"string"},"node":{"type":"string"}},"required":["title","node"],"additionalProperties":false,"$defs":{}}, 'node_patch.rename input') },
  validateOutput(value): asserts value is NodePatchRenameOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_patch.rename output') },
}

export type NodePatchMoveInput = { "parent_node": string; "expect_parent_node"?: string; "node": string }

export type NodePatchMoveOutput = { "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }

export type NodePatchMoveError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict" | "DriveMoved" | "DriveRestoreDestinationRequired" | "DriveOverQuota"

const operationNodePatchMove: Operation<NodePatchMoveInput, NodePatchMoveOutput, NodePatchMoveError> = {
  id: "node_patch.move",
  owner: "drive",
  method: "PATCH",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: {"tag":"DriveNode","id":"name","version":"modified"},
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict","DriveMoved","DriveRestoreDestinationRequired","DriveOverQuota"],
  validateInput(value): asserts value is NodePatchMoveInput { assertSchema(value, {"type":"object","properties":{"parent_node":{"title":"Parent Node","type":"string"},"expect_parent_node":{"title":"Expect Parent Node","type":"string"},"node":{"type":"string"}},"required":["parent_node","node"],"additionalProperties":false,"$defs":{}}, 'node_patch.move input') },
  validateOutput(value): asserts value is NodePatchMoveOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_patch.move output') },
}

export type NodePatchTrashInput = { "state": "Trashed"; "node": string }

export type NodePatchTrashOutput = { "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }

export type NodePatchTrashError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict" | "DriveMoved" | "DriveRestoreDestinationRequired" | "DriveOverQuota"

const operationNodePatchTrash: Operation<NodePatchTrashInput, NodePatchTrashOutput, NodePatchTrashError> = {
  id: "node_patch.trash",
  owner: "drive",
  method: "PATCH",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: {"tag":"DriveNode","id":"name","version":"modified"},
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict","DriveMoved","DriveRestoreDestinationRequired","DriveOverQuota"],
  validateInput(value): asserts value is NodePatchTrashInput { assertSchema(value, {"type":"object","properties":{"state":{"const":"Trashed","title":"State","type":"string"},"node":{"type":"string"}},"required":["state","node"],"additionalProperties":false,"$defs":{}}, 'node_patch.trash input') },
  validateOutput(value): asserts value is NodePatchTrashOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_patch.trash output') },
}

export type NodePatchRestoreInput = { "state": "Active"; "parent_node"?: string; "node": string }

export type NodePatchRestoreOutput = { "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }

export type NodePatchRestoreError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict" | "DriveMoved" | "DriveRestoreDestinationRequired" | "DriveOverQuota"

const operationNodePatchRestore: Operation<NodePatchRestoreInput, NodePatchRestoreOutput, NodePatchRestoreError> = {
  id: "node_patch.restore",
  owner: "drive",
  method: "PATCH",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: {"tag":"DriveNode","id":"name","version":"modified"},
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict","DriveMoved","DriveRestoreDestinationRequired","DriveOverQuota"],
  validateInput(value): asserts value is NodePatchRestoreInput { assertSchema(value, {"type":"object","properties":{"state":{"const":"Active","title":"State","type":"string"},"parent_node":{"title":"Parent Node","type":"string"},"node":{"type":"string"}},"required":["state","node"],"additionalProperties":false,"$defs":{}}, 'node_patch.restore input') },
  validateOutput(value): asserts value is NodePatchRestoreOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_patch.restore output') },
}

export type NodePatchStampInput = { "content_modified": string; "node": string }

export type NodePatchStampOutput = { "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }

export type NodePatchStampError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict" | "DriveMoved" | "DriveRestoreDestinationRequired" | "DriveOverQuota"

const operationNodePatchStamp: Operation<NodePatchStampInput, NodePatchStampOutput, NodePatchStampError> = {
  id: "node_patch.stamp",
  owner: "drive",
  method: "PATCH",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: {"tag":"DriveNode","id":"name","version":"modified"},
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict","DriveMoved","DriveRestoreDestinationRequired","DriveOverQuota"],
  validateInput(value): asserts value is NodePatchStampInput { assertSchema(value, {"type":"object","properties":{"content_modified":{"title":"Content Modified","type":"string"},"node":{"type":"string"}},"required":["content_modified","node"],"additionalProperties":false,"$defs":{}}, 'node_patch.stamp input') },
  validateOutput(value): asserts value is NodePatchStampOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_patch.stamp output') },
}

export type NodePurgeInput = { "node": string }

export type NodePurgeOutput = { "count": number }

export type NodePurgeError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict"

const operationNodePurge: Operation<NodePurgeInput, NodePurgeOutput, NodePurgeError> = {
  id: "node_purge",
  owner: "drive",
  method: "DELETE",
  path: "nodes/{node}",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is NodePurgeInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_purge input') },
  validateOutput(value): asserts value is NodePurgeOutput { assertSchema(value, {"description":"The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).","properties":{"count":{"title":"Count","type":"integer"}},"required":["count"],"title":"Count","type":"object"}, 'node_purge output') },
}

export type NodeChildrenInput = { "limit"?: number; "cursor"?: string; "order_by"?: string; "ascending"?: boolean; "type"?: string; "expand"?: string; "node": string }

export type NodeChildrenOutput = { "rows": Array<{ "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }>; "next_cursor": (string) | (null) }

export type NodeChildrenError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveConflict"

const operationNodeChildren: Operation<NodeChildrenInput, NodeChildrenOutput, NodeChildrenError> = {
  id: "node_children",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/children",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveConflict"],
  validateInput(value): asserts value is NodeChildrenInput { assertSchema(value, {"type":"object","properties":{"limit":{"title":"Limit","type":"integer"},"cursor":{"title":"Cursor","type":"string"},"order_by":{"title":"Order By","type":"string"},"ascending":{"title":"Ascending","type":"boolean"},"type":{"title":"Type","type":"string"},"expand":{"title":"Expand","type":"string"},"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_children input') },
  validateOutput(value): asserts value is NodeChildrenOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"NodeShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"rows":{"items":{"$ref":"#/$defs/NodeShape"},"title":"Rows","type":"array"},"next_cursor":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Next Cursor"}},"required":["rows","next_cursor"],"title":"Page","type":"object"}, 'node_children output') },
}

export type NodeCopyInput = { "parent_node": string; "title"?: string; "node": string }

export type NodeCopyOutput = { "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }

export type NodeCopyError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict" | "DriveOverQuota"

const operationNodeCopy: Operation<NodeCopyInput, NodeCopyOutput, NodeCopyError> = {
  id: "node_copy",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/copy",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict","DriveOverQuota"],
  validateInput(value): asserts value is NodeCopyInput { assertSchema(value, {"type":"object","properties":{"parent_node":{"title":"Parent Node","type":"string"},"title":{"title":"Title","type":"string"},"node":{"type":"string"}},"required":["parent_node","node"],"additionalProperties":false,"$defs":{}}, 'node_copy input') },
  validateOutput(value): asserts value is NodeCopyOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_copy output') },
}

export type NodeArchiveStartInput = { "node": string }

export type NodeArchiveStartOutput = { "status": "building" | "ready" | "failed"; "file_name": (string) | (null); "size": (number) | (null); "error": (string) | (null) }

export type NodeArchiveStartError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveConflict"

const operationNodeArchiveStart: Operation<NodeArchiveStartInput, NodeArchiveStartOutput, NodeArchiveStartError> = {
  id: "node_archive_start",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/archive",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveConflict"],
  validateInput(value): asserts value is NodeArchiveStartInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_archive_start input') },
  validateOutput(value): asserts value is NodeArchiveStartOutput { assertSchema(value, {"properties":{"status":{"enum":["building","ready","failed"],"title":"Status","type":"string"},"file_name":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"File Name"},"size":{"anyOf":[{"type":"integer"},{"type":"null"}],"title":"Size"},"error":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Error"}},"required":["status","file_name","size","error"],"title":"ArchiveStatus","type":"object"}, 'node_archive_start output') },
}

export type NodeArchiveStatusInput = { "node": string }

export type NodeArchiveStatusOutput = { "status": "building" | "ready" | "failed"; "file_name": (string) | (null); "size": (number) | (null); "error": (string) | (null) }

export type NodeArchiveStatusError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveConflict"

const operationNodeArchiveStatus: Operation<NodeArchiveStatusInput, NodeArchiveStatusOutput, NodeArchiveStatusError> = {
  id: "node_archive_status",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/archive",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveConflict"],
  validateInput(value): asserts value is NodeArchiveStatusInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_archive_status input') },
  validateOutput(value): asserts value is NodeArchiveStatusOutput { assertSchema(value, {"properties":{"status":{"enum":["building","ready","failed"],"title":"Status","type":"string"},"file_name":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"File Name"},"size":{"anyOf":[{"type":"integer"},{"type":"null"}],"title":"Size"},"error":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Error"}},"required":["status","file_name","size","error"],"title":"ArchiveStatus","type":"object"}, 'node_archive_status output') },
}

export type NodeArchiveDownloadInput = { "node": string }

export type NodeArchiveDownloadOutput = Blob

export type NodeArchiveDownloadError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveConflict"

const operationNodeArchiveDownload: Operation<NodeArchiveDownloadInput, NodeArchiveDownloadOutput, NodeArchiveDownloadError> = {
  id: "node_archive_download",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/archive/download",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveConflict"],
  validateInput(value): asserts value is NodeArchiveDownloadInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_archive_download input') },
  validateOutput(value): asserts value is NodeArchiveDownloadOutput { void value },
}

export type NodePutContentInput = { "upload_id": string; "checksum"?: string; "content_modified"?: string; "node": string }

export type NodePutContentOutput = { "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }

export type NodePutContentError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict" | "DriveOverQuota" | "DriveFileTooLarge"

const operationNodePutContent: Operation<NodePutContentInput, NodePutContentOutput, NodePutContentError> = {
  id: "node_put_content",
  owner: "drive",
  method: "PUT",
  path: "nodes/{node}/content",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict","DriveOverQuota","DriveFileTooLarge"],
  validateInput(value): asserts value is NodePutContentInput { assertSchema(value, {"type":"object","properties":{"upload_id":{"title":"Upload Id","type":"string"},"checksum":{"title":"Checksum","type":"string"},"content_modified":{"title":"Content Modified","type":"string"},"node":{"type":"string"}},"required":["upload_id","node"],"additionalProperties":false,"$defs":{}}, 'node_put_content input') },
  validateOutput(value): asserts value is NodePutContentOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'node_put_content output') },
}

export type NodeGetContentInput = { "format"?: string; "node": string }

export type NodeGetContentOutput = Blob

export type NodeGetContentError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict"

const operationNodeGetContent: Operation<NodeGetContentInput, NodeGetContentOutput, NodeGetContentError> = {
  id: "node_get_content",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/content",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is NodeGetContentInput { assertSchema(value, {"type":"object","properties":{"format":{"title":"Format","type":"string"},"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_get_content input') },
  validateOutput(value): asserts value is NodeGetContentOutput { void value },
}

export type NodeMediaInput = { "node": string }

export type NodeMediaOutput = { "media": Array<{ "node": string; "title": string; "mime": (string) | (null); "size": number; "url": string; "expires": number }> }

export type NodeMediaError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveConflict"

const operationNodeMedia: Operation<NodeMediaInput, NodeMediaOutput, NodeMediaError> = {
  id: "node_media",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/media",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveConflict"],
  validateInput(value): asserts value is NodeMediaInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_media input') },
  validateOutput(value): asserts value is NodeMediaOutput { assertSchema(value, {"$defs":{"MediaItem":{"properties":{"node":{"title":"Node","type":"string"},"title":{"title":"Title","type":"string"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"size":{"title":"Size","type":"integer"},"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["node","title","mime","size","url","expires"],"title":"MediaItem","type":"object"}},"properties":{"media":{"items":{"$ref":"#/$defs/MediaItem"},"title":"Media","type":"array"}},"required":["media"],"title":"MediaList","type":"object"}, 'node_media output') },
}

export type NodePreviewInput = { "image": string; "mime": string; "node": string }

export type NodePreviewOutput = { "preview": ({ "url": string; "expires": number }) | (null) }

export type NodePreviewError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden"

const operationNodePreview: Operation<NodePreviewInput, NodePreviewOutput, NodePreviewError> = {
  id: "node_preview",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/preview",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden"],
  validateInput(value): asserts value is NodePreviewInput { assertSchema(value, {"type":"object","properties":{"image":{"title":"Image","type":"string"},"mime":{"title":"Mime","type":"string"},"node":{"type":"string"}},"required":["image","mime","node"],"additionalProperties":false,"$defs":{}}, 'node_preview input') },
  validateOutput(value): asserts value is NodePreviewOutput { assertSchema(value, {"$defs":{"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]}},"required":["preview"],"title":"PreviewAnswer","type":"object"}, 'node_preview output') },
}

export type UploadCreateInput = { "parent_node": string; "filename": string; "size": number; "mime"?: string; "replaces"?: string }

export type UploadCreateOutput = ({ "upload_id": string; "mode": "chunked" }) | ({ "upload_id": string; "mode": "direct"; "url": string; "fields": { [key: string]: string } })

export type UploadCreateError = "DriveNotFound" | "DriveForbidden" | "DriveConflict" | "DriveOverQuota" | "DriveFileTooLarge"

const operationUploadCreate: Operation<UploadCreateInput, UploadCreateOutput, UploadCreateError> = {
  id: "upload_create",
  owner: "drive",
  method: "POST",
  path: "uploads",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveConflict","DriveOverQuota","DriveFileTooLarge"],
  validateInput(value): asserts value is UploadCreateInput { assertSchema(value, {"type":"object","properties":{"parent_node":{"title":"Parent Node","type":"string"},"filename":{"title":"Filename","type":"string"},"size":{"title":"Size","type":"integer"},"mime":{"title":"Mime","type":"string"},"replaces":{"title":"Replaces","type":"string"}},"required":["parent_node","filename","size"],"additionalProperties":false,"$defs":{}}, 'upload_create input') },
  validateOutput(value): asserts value is UploadCreateOutput { assertSchema(value, {"$defs":{"ChunkedUpload":{"description":"A session that takes its bytes through `PUT /uploads/<id>/chunk`.","properties":{"upload_id":{"title":"Upload Id","type":"string"},"mode":{"const":"chunked","title":"Mode","type":"string"}},"required":["upload_id","mode"],"title":"ChunkedUpload","type":"object"},"DirectUpload":{"description":"A session that takes its bytes at the storage `url`, `fields` first.","properties":{"upload_id":{"title":"Upload Id","type":"string"},"mode":{"const":"direct","title":"Mode","type":"string"},"url":{"title":"Url","type":"string"},"fields":{"additionalProperties":{"type":"string"},"title":"Fields","type":"object"}},"required":["upload_id","mode","url","fields"],"title":"DirectUpload","type":"object"}},"anyOf":[{"$ref":"#/$defs/ChunkedUpload"},{"$ref":"#/$defs/DirectUpload"}]}, 'upload_create output') },
}

export type UploadChunkInput = { "offset": number; "upload_id": string; "chunk": unknown } & { chunk: Blob }

export type UploadChunkOutput = { "upload_id": string; "received": number }

export type UploadChunkError = "DriveNotFound" | "DriveForbidden" | "DriveConflict" | "DriveFileTooLarge"

const operationUploadChunk: Operation<UploadChunkInput, UploadChunkOutput, UploadChunkError> = {
  id: "upload_chunk",
  owner: "drive",
  method: "PUT",
  path: "uploads/{upload_id}/chunk",
  prefix: "/api/suite/drive/",
  pathParams: ["upload_id"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveConflict","DriveFileTooLarge"],
  body: 'chunk',
  validateInput(value): asserts value is UploadChunkInput { assertSchema(value, {"type":"object","properties":{"offset":{"title":"Offset","type":"integer"},"upload_id":{"type":"string"},"chunk":{}},"required":["offset","upload_id","chunk"],"additionalProperties":false,"$defs":{}}, 'upload_chunk input') },
  validateOutput(value): asserts value is UploadChunkOutput { assertSchema(value, {"properties":{"upload_id":{"title":"Upload Id","type":"string"},"received":{"title":"Received","type":"integer"}},"required":["upload_id","received"],"title":"UploadProgress","type":"object"}, 'upload_chunk output') },
}

export type UploadFinishInput = { "parent_node"?: string; "title"?: string; "replaces"?: string; "checksum"?: string; "content_modified"?: string; "upload_id": string }

export type UploadFinishOutput = { "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }

export type UploadFinishError = "DriveNotFound" | "DriveForbidden" | "DriveConflict" | "DriveOverQuota" | "DriveFileTooLarge"

const operationUploadFinish: Operation<UploadFinishInput, UploadFinishOutput, UploadFinishError> = {
  id: "upload_finish",
  owner: "drive",
  method: "POST",
  path: "uploads/{upload_id}/finish",
  prefix: "/api/suite/drive/",
  pathParams: ["upload_id"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveConflict","DriveOverQuota","DriveFileTooLarge"],
  validateInput(value): asserts value is UploadFinishInput { assertSchema(value, {"type":"object","properties":{"parent_node":{"title":"Parent Node","type":"string"},"title":{"title":"Title","type":"string"},"replaces":{"title":"Replaces","type":"string"},"checksum":{"title":"Checksum","type":"string"},"content_modified":{"title":"Content Modified","type":"string"},"upload_id":{"type":"string"}},"required":["upload_id"],"additionalProperties":false,"$defs":{}}, 'upload_finish input') },
  validateOutput(value): asserts value is UploadFinishOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"}, 'upload_finish output') },
}

export type NodeActivityInput = { "limit"?: number; "cursor"?: string; "node": string }

export type NodeActivityOutput = { "rows": Array<{ "name": string; "node": string; "action": string; "actor": string; "at": (string) | (null); "via_link": (string) | (null); "client": (string) | (null); "detail": {  } }>; "next_cursor": (string) | (null) }

export type NodeActivityError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict"

const operationNodeActivity: Operation<NodeActivityInput, NodeActivityOutput, NodeActivityError> = {
  id: "node_activity",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/activity",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is NodeActivityInput { assertSchema(value, {"type":"object","properties":{"limit":{"title":"Limit","type":"integer"},"cursor":{"title":"Cursor","type":"string"},"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_activity input') },
  validateOutput(value): asserts value is NodeActivityOutput { assertSchema(value, {"$defs":{"ActivityShape":{"properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"action":{"title":"Action","type":"string"},"actor":{"title":"Actor","type":"string"},"at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"At"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"client":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Client"},"detail":{"additionalProperties":true,"title":"Detail","type":"object"}},"required":["name","node","action","actor","at","via_link","client","detail"],"title":"ActivityShape","type":"object"}},"properties":{"rows":{"items":{"$ref":"#/$defs/ActivityShape"},"title":"Rows","type":"array"},"next_cursor":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Next Cursor"}},"required":["rows","next_cursor"],"title":"Page","type":"object"}, 'node_activity output') },
}

export type NodeVisitInput = { "node": string }

export type NodeVisitOutput = { "count": number }

export type NodeVisitError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveConflict"

const operationNodeVisit: Operation<NodeVisitInput, NodeVisitOutput, NodeVisitError> = {
  id: "node_visit",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/visit",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveConflict"],
  validateInput(value): asserts value is NodeVisitInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_visit input') },
  validateOutput(value): asserts value is NodeVisitOutput { assertSchema(value, {"description":"The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).","properties":{"count":{"title":"Count","type":"integer"}},"required":["count"],"title":"Count","type":"object"}, 'node_visit output') },
}

export type NodePutFavouriteInput = { "node": string }

export type NodePutFavouriteOutput = { "count": number }

export type NodePutFavouriteError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden"

const operationNodePutFavourite: Operation<NodePutFavouriteInput, NodePutFavouriteOutput, NodePutFavouriteError> = {
  id: "node_put_favourite",
  owner: "drive",
  method: "PUT",
  path: "nodes/{node}/favourite",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden"],
  validateInput(value): asserts value is NodePutFavouriteInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_put_favourite input') },
  validateOutput(value): asserts value is NodePutFavouriteOutput { assertSchema(value, {"description":"The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).","properties":{"count":{"title":"Count","type":"integer"}},"required":["count"],"title":"Count","type":"object"}, 'node_put_favourite output') },
}

export type NodeDeleteFavouriteInput = { "node": string }

export type NodeDeleteFavouriteOutput = { "count": number }

export type NodeDeleteFavouriteError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired"

const operationNodeDeleteFavourite: Operation<NodeDeleteFavouriteInput, NodeDeleteFavouriteOutput, NodeDeleteFavouriteError> = {
  id: "node_delete_favourite",
  owner: "drive",
  method: "DELETE",
  path: "nodes/{node}/favourite",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired"],
  validateInput(value): asserts value is NodeDeleteFavouriteInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_delete_favourite input') },
  validateOutput(value): asserts value is NodeDeleteFavouriteOutput { assertSchema(value, {"description":"The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).","properties":{"count":{"title":"Count","type":"integer"}},"required":["count"],"title":"Count","type":"object"}, 'node_delete_favourite output') },
}

export type NodeGrantsInput = { "inherited"?: boolean; "principal"?: string; "node": string }

export type NodeGrantsOutput = { "grants": Array<{ "name": string; "node": string; "principal": string; "role": number; "person"?: { "id": string; "full_name": string; "user_image": (string) | (null) }; "expires_on": (string) | (null); "has_password": boolean; "sent_to": (string) | (null); "url"?: string }>; "owner": ({ "id": string; "full_name": string; "user_image": (string) | (null) }) | (null); "inherited"?: Array<{ "grant": ({ "name": string; "node": string; "principal": string; "role": number; "person"?: { "id": string; "full_name": string; "user_image": (string) | (null) }; "expires_on": (string) | (null); "has_password": boolean; "sent_to": (string) | (null); "url"?: string }) | ({ "node": string; "principal": "$LINK"; "role": number; "expires_on": (string) | (null); "has_password": boolean }); "redacted": boolean; "source_node": string; "source_title": string }>; "explain"?: { "role": number; "source": string; "rows": Array<{ "node": string; "depth": number; "principal": string; "role": number; "expires_on": (string) | (null); "pass": number; "held": boolean; "winner": boolean }> } }

export type NodeGrantsError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden"

const operationNodeGrants: Operation<NodeGrantsInput, NodeGrantsOutput, NodeGrantsError> = {
  id: "node_grants",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/grants",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden"],
  validateInput(value): asserts value is NodeGrantsInput { assertSchema(value, {"type":"object","properties":{"inherited":{"title":"Inherited","type":"boolean"},"principal":{"title":"Principal","type":"string"},"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_grants input') },
  validateOutput(value): asserts value is NodeGrantsOutput { assertSchema(value, {"$defs":{"ExplainRowShape":{"properties":{"node":{"title":"Node","type":"string"},"depth":{"title":"Depth","type":"integer"},"principal":{"title":"Principal","type":"string"},"role":{"title":"Role","type":"integer"},"expires_on":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Expires On"},"pass":{"title":"Pass","type":"integer"},"held":{"title":"Held","type":"boolean"},"winner":{"title":"Winner","type":"boolean"}},"required":["node","depth","principal","role","expires_on","pass","held","winner"],"title":"ExplainRowShape","type":"object"},"ExplainShape":{"properties":{"role":{"title":"Role","type":"integer"},"source":{"title":"Source","type":"string"},"rows":{"items":{"$ref":"#/$defs/ExplainRowShape"},"title":"Rows","type":"array"}},"required":["role","source","rows"],"title":"ExplainShape","type":"object"},"GrantShape":{"properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"principal":{"title":"Principal","type":"string"},"role":{"title":"Role","type":"integer"},"person":{"$ref":"#/$defs/Person"},"expires_on":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Expires On"},"has_password":{"title":"Has Password","type":"boolean"},"sent_to":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Sent To"},"url":{"title":"Url","type":"string"}},"required":["name","node","principal","role","expires_on","has_password","sent_to"],"title":"GrantShape","type":"object"},"InheritedGrantShape":{"properties":{"grant":{"anyOf":[{"$ref":"#/$defs/GrantShape"},{"$ref":"#/$defs/RedactedGrantShape"}],"title":"Grant"},"redacted":{"title":"Redacted","type":"boolean"},"source_node":{"title":"Source Node","type":"string"},"source_title":{"title":"Source Title","type":"string"}},"required":["grant","redacted","source_node","source_title"],"title":"InheritedGrantShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"RedactedGrantShape":{"description":"An ancestor's link the caller does not manage: no name, URL, or recipient.","properties":{"node":{"title":"Node","type":"string"},"principal":{"const":"$LINK","title":"Principal","type":"string"},"role":{"title":"Role","type":"integer"},"expires_on":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Expires On"},"has_password":{"title":"Has Password","type":"boolean"}},"required":["node","principal","role","expires_on","has_password"],"title":"RedactedGrantShape","type":"object"}},"description":"`GET /nodes/<id>/grants`: the local rows, who owns the tree, and the asked-for extras.","properties":{"grants":{"items":{"$ref":"#/$defs/GrantShape"},"title":"Grants","type":"array"},"owner":{"anyOf":[{"$ref":"#/$defs/Person"},{"type":"null"}]},"inherited":{"items":{"$ref":"#/$defs/InheritedGrantShape"},"title":"Inherited","type":"array"},"explain":{"$ref":"#/$defs/ExplainShape"}},"required":["grants","owner"],"title":"GrantsShape","type":"object"}, 'node_grants output') },
}

export type NodePutGrantInput = { "role": number; "expires_on"?: (string) | (null); "password"?: (string) | (null); "send_to"?: string; "notify"?: boolean; "node": string; "principal": string }

export type NodePutGrantOutput = { "name": string; "node": string; "principal": string; "role": number; "person"?: { "id": string; "full_name": string; "user_image": (string) | (null) }; "expires_on": (string) | (null); "has_password": boolean; "sent_to": (string) | (null); "url"?: string }

export type NodePutGrantError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden"

const operationNodePutGrant: Operation<NodePutGrantInput, NodePutGrantOutput, NodePutGrantError> = {
  id: "node_put_grant",
  owner: "drive",
  method: "PUT",
  path: "nodes/{node}/grants/{principal:path}",
  prefix: "/api/suite/drive/",
  pathParams: ["node","principal"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden"],
  validateInput(value): asserts value is NodePutGrantInput { assertSchema(value, {"type":"object","properties":{"role":{"title":"Role","type":"integer"},"expires_on":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Expires On"},"password":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Password"},"send_to":{"title":"Send To","type":"string"},"notify":{"title":"Notify","type":"boolean"},"node":{"type":"string"},"principal":{"type":"string"}},"required":["role","node","principal"],"additionalProperties":false,"$defs":{}}, 'node_put_grant input') },
  validateOutput(value): asserts value is NodePutGrantOutput { assertSchema(value, {"$defs":{"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"principal":{"title":"Principal","type":"string"},"role":{"title":"Role","type":"integer"},"person":{"$ref":"#/$defs/Person"},"expires_on":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Expires On"},"has_password":{"title":"Has Password","type":"boolean"},"sent_to":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Sent To"},"url":{"title":"Url","type":"string"}},"required":["name","node","principal","role","expires_on","has_password","sent_to"],"title":"GrantShape","type":"object"}, 'node_put_grant output') },
}

export type NodeDeleteGrantInput = { "below"?: boolean; "node": string; "principal": string }

export type NodeDeleteGrantOutput = { "count": number }

export type NodeDeleteGrantError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden"

const operationNodeDeleteGrant: Operation<NodeDeleteGrantInput, NodeDeleteGrantOutput, NodeDeleteGrantError> = {
  id: "node_delete_grant",
  owner: "drive",
  method: "DELETE",
  path: "nodes/{node}/grants/{principal:path}",
  prefix: "/api/suite/drive/",
  pathParams: ["node","principal"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden"],
  validateInput(value): asserts value is NodeDeleteGrantInput { assertSchema(value, {"type":"object","properties":{"below":{"title":"Below","type":"boolean"},"node":{"type":"string"},"principal":{"type":"string"}},"required":["node","principal"],"additionalProperties":false,"$defs":{}}, 'node_delete_grant input') },
  validateOutput(value): asserts value is NodeDeleteGrantOutput { assertSchema(value, {"description":"The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).","properties":{"count":{"title":"Count","type":"integer"}},"required":["count"],"title":"Count","type":"object"}, 'node_delete_grant output') },
}

export type GrantPatchInput = { "role": number; "expires_on"?: (string) | (null); "password"?: (string) | (null); "grant": string }

export type GrantPatchOutput = { "name": string; "node": string; "principal": string; "role": number; "person"?: { "id": string; "full_name": string; "user_image": (string) | (null) }; "expires_on": (string) | (null); "has_password": boolean; "sent_to": (string) | (null); "url"?: string }

export type GrantPatchError = "DriveNotFound" | "DriveForbidden"

const operationGrantPatch: Operation<GrantPatchInput, GrantPatchOutput, GrantPatchError> = {
  id: "grant_patch",
  owner: "drive",
  method: "PATCH",
  path: "grants/{grant}",
  prefix: "/api/suite/drive/",
  pathParams: ["grant"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden"],
  validateInput(value): asserts value is GrantPatchInput { assertSchema(value, {"type":"object","properties":{"role":{"title":"Role","type":"integer"},"expires_on":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Expires On"},"password":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Password"},"grant":{"type":"string"}},"required":["role","grant"],"additionalProperties":false,"$defs":{}}, 'grant_patch input') },
  validateOutput(value): asserts value is GrantPatchOutput { assertSchema(value, {"$defs":{"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"principal":{"title":"Principal","type":"string"},"role":{"title":"Role","type":"integer"},"person":{"$ref":"#/$defs/Person"},"expires_on":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Expires On"},"has_password":{"title":"Has Password","type":"boolean"},"sent_to":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Sent To"},"url":{"title":"Url","type":"string"}},"required":["name","node","principal","role","expires_on","has_password","sent_to"],"title":"GrantShape","type":"object"}, 'grant_patch output') },
}

export type GrantDeleteInput = { "grant": string }

export type GrantDeleteOutput = { "count": number }

export type GrantDeleteError = "DriveNotFound" | "DriveForbidden"

const operationGrantDelete: Operation<GrantDeleteInput, GrantDeleteOutput, GrantDeleteError> = {
  id: "grant_delete",
  owner: "drive",
  method: "DELETE",
  path: "grants/{grant}",
  prefix: "/api/suite/drive/",
  pathParams: ["grant"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden"],
  validateInput(value): asserts value is GrantDeleteInput { assertSchema(value, {"type":"object","properties":{"grant":{"type":"string"}},"required":["grant"],"additionalProperties":false,"$defs":{}}, 'grant_delete input') },
  validateOutput(value): asserts value is GrantDeleteOutput { assertSchema(value, {"description":"The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).","properties":{"count":{"title":"Count","type":"integer"}},"required":["count"],"title":"Count","type":"object"}, 'grant_delete output') },
}

export type GrantRotateInput = { "grant": string }

export type GrantRotateOutput = { "name": string; "node": string; "principal": string; "role": number; "person"?: { "id": string; "full_name": string; "user_image": (string) | (null) }; "expires_on": (string) | (null); "has_password": boolean; "sent_to": (string) | (null); "url"?: string }

export type GrantRotateError = "DriveNotFound" | "DriveForbidden"

const operationGrantRotate: Operation<GrantRotateInput, GrantRotateOutput, GrantRotateError> = {
  id: "grant_rotate",
  owner: "drive",
  method: "POST",
  path: "grants/{grant}/rotate",
  prefix: "/api/suite/drive/",
  pathParams: ["grant"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden"],
  validateInput(value): asserts value is GrantRotateInput { assertSchema(value, {"type":"object","properties":{"grant":{"type":"string"}},"required":["grant"],"additionalProperties":false,"$defs":{}}, 'grant_rotate input') },
  validateOutput(value): asserts value is GrantRotateOutput { assertSchema(value, {"$defs":{"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"principal":{"title":"Principal","type":"string"},"role":{"title":"Role","type":"integer"},"person":{"$ref":"#/$defs/Person"},"expires_on":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Expires On"},"has_password":{"title":"Has Password","type":"boolean"},"sent_to":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Sent To"},"url":{"title":"Url","type":"string"}},"required":["name","node","principal","role","expires_on","has_password","sent_to"],"title":"GrantShape","type":"object"}, 'grant_rotate output') },
}

export type LinkUnlockInput = { "token": string; "password": string }

export type LinkUnlockOutput = { "ticket": string; "expires": number }

export type LinkUnlockError = "DriveNotFound" | "DriveForbidden" | "DriveLocked" | "DriveLinkExpired" | "RateLimitExceededError"

const operationLinkUnlock: Operation<LinkUnlockInput, LinkUnlockOutput, LinkUnlockError> = {
  id: "link_unlock",
  owner: "drive",
  method: "POST",
  path: "links/unlock",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveLocked","DriveLinkExpired","RateLimitExceededError"],
  validateInput(value): asserts value is LinkUnlockInput { assertSchema(value, {"type":"object","properties":{"token":{"title":"Token","type":"string"},"password":{"title":"Password","type":"string"}},"required":["token","password"],"additionalProperties":false,"$defs":{}}, 'link_unlock input') },
  validateOutput(value): asserts value is LinkUnlockOutput { assertSchema(value, {"properties":{"ticket":{"title":"Ticket","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["ticket","expires"],"title":"UnlockTicket","type":"object"}, 'link_unlock output') },
}

export type ViewClearRecentsInput = { "nodes"?: Array<string> }

export type ViewClearRecentsOutput = { "count": number }

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
  validateInput(value): asserts value is ViewClearRecentsInput { assertSchema(value, {"type":"object","properties":{"nodes":{"items":{"type":"string"},"title":"Nodes","type":"array"}},"required":[],"additionalProperties":false,"$defs":{}}, 'view_clear_recents input') },
  validateOutput(value): asserts value is ViewClearRecentsOutput { assertSchema(value, {"description":"The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).","properties":{"count":{"title":"Count","type":"integer"}},"required":["count"],"title":"Count","type":"object"}, 'view_clear_recents output') },
}

export type ViewListInput = { "limit"?: number; "cursor"?: string; "root"?: string; "content_doctype"?: string; "term"?: string; "type"?: string; "expand"?: string; "view": string }

export type ViewListOutput = { "rows": Array<({ "name": string; "title": string; "kind": string; "parent_node": (string) | (null); "root": string; "state": string; "trash_root": (string) | (null); "size": number; "mime": (string) | (null); "url": (string) | (null); "content_doctype": (string) | (null); "content_docname": (string) | (null); "is_template": number; "owner": { "id": string; "full_name": string; "user_image": (string) | (null) }; "creation": (string) | (null); "modified": (string) | (null); "content_modified": (string) | (null); "access"?: { "role"?: number; "via_link"?: (string) | (null); "source_node"?: (string) | (null); "source_principal"?: (string) | (null) }; "breadcrumbs"?: Array<{ "name": string; "title": string; "kind": string }>; "preview"?: ({ "url": string; "expires": number }) | (null); "opened_at"?: (string) | (null); "favourite"?: boolean }) | ({ "root": string; "user": (string) | (null); "used_bytes": number; "quota_bytes": number })>; "next_cursor": (string) | (null) }

export type ViewListError = "DriveNotFound" | "DriveForbidden"

const operationViewList: Operation<ViewListInput, ViewListOutput, ViewListError> = {
  id: "view_list",
  owner: "drive",
  method: "GET",
  path: "views/{view}",
  prefix: "/api/suite/drive/",
  pathParams: ["view"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden"],
  validateInput(value): asserts value is ViewListInput { assertSchema(value, {"type":"object","properties":{"limit":{"title":"Limit","type":"integer"},"cursor":{"title":"Cursor","type":"string"},"root":{"title":"Root","type":"string"},"content_doctype":{"title":"Content Doctype","type":"string"},"term":{"title":"Term","type":"string"},"type":{"title":"Type","type":"string"},"expand":{"title":"Expand","type":"string"},"view":{"type":"string"}},"required":["view"],"additionalProperties":false,"$defs":{}}, 'view_list input') },
  validateOutput(value): asserts value is ViewListOutput { assertSchema(value, {"$defs":{"AccessShape":{"properties":{"role":{"title":"Role","type":"integer"},"via_link":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Via Link"},"source_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Node"},"source_principal":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Source Principal"}},"title":"AccessShape","type":"object"},"ArchivedRootShape":{"properties":{"root":{"title":"Root","type":"string"},"user":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User"},"used_bytes":{"title":"Used Bytes","type":"integer"},"quota_bytes":{"title":"Quota Bytes","type":"integer"}},"required":["root","user","used_bytes","quota_bytes"],"title":"ArchivedRootShape","type":"object"},"BreadcrumbShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"}},"required":["name","title","kind"],"title":"BreadcrumbShape","type":"object"},"NodeShape":{"properties":{"name":{"title":"Name","type":"string"},"title":{"title":"Title","type":"string"},"kind":{"title":"Kind","type":"string"},"parent_node":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Parent Node"},"root":{"title":"Root","type":"string"},"state":{"title":"State","type":"string"},"trash_root":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Trash Root"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"url":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Url"},"content_doctype":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Doctype"},"content_docname":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Docname"},"is_template":{"title":"Is Template","type":"integer"},"owner":{"$ref":"#/$defs/Person"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"},"content_modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Content Modified"},"access":{"$ref":"#/$defs/AccessShape"},"breadcrumbs":{"items":{"$ref":"#/$defs/BreadcrumbShape"},"title":"Breadcrumbs","type":"array"},"preview":{"anyOf":[{"$ref":"#/$defs/PreviewShape"},{"type":"null"}]},"opened_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Opened At"},"favourite":{"title":"Favourite","type":"boolean"}},"required":["name","title","kind","parent_node","root","state","trash_root","size","mime","url","content_doctype","content_docname","is_template","owner","creation","modified","content_modified"],"title":"NodeShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"PreviewShape":{"properties":{"url":{"title":"Url","type":"string"},"expires":{"title":"Expires","type":"integer"}},"required":["url","expires"],"title":"PreviewShape","type":"object"}},"properties":{"rows":{"items":{"anyOf":[{"$ref":"#/$defs/NodeShape"},{"$ref":"#/$defs/ArchivedRootShape"}]},"title":"Rows","type":"array"},"next_cursor":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Next Cursor"}},"required":["rows","next_cursor"],"title":"Page","type":"object"}, 'view_list output') },
}

export type NodeVersionsInput = { "limit"?: number; "cursor"?: string; "node": string }

export type NodeVersionsOutput = { "rows": Array<{ "name": string; "node": string; "seq": number; "kind": string; "label": (string) | (null); "pinned": number; "actor": string; "size": number; "creation": (string) | (null) }>; "next_cursor": (string) | (null) }

export type NodeVersionsError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveConflict"

const operationNodeVersions: Operation<NodeVersionsInput, NodeVersionsOutput, NodeVersionsError> = {
  id: "node_versions",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/versions",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveConflict"],
  validateInput(value): asserts value is NodeVersionsInput { assertSchema(value, {"type":"object","properties":{"limit":{"title":"Limit","type":"integer"},"cursor":{"title":"Cursor","type":"string"},"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_versions input') },
  validateOutput(value): asserts value is NodeVersionsOutput { assertSchema(value, {"$defs":{"VersionShape":{"properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"seq":{"title":"Seq","type":"integer"},"kind":{"title":"Kind","type":"string"},"label":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Label"},"pinned":{"title":"Pinned","type":"integer"},"actor":{"title":"Actor","type":"string"},"size":{"title":"Size","type":"integer"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"}},"required":["name","node","seq","kind","label","pinned","actor","size","creation"],"title":"VersionShape","type":"object"}},"properties":{"rows":{"items":{"$ref":"#/$defs/VersionShape"},"title":"Rows","type":"array"},"next_cursor":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Next Cursor"}},"required":["rows","next_cursor"],"title":"Page","type":"object"}, 'node_versions output') },
}

export type NodeVersionCreateInput = { "kind"?: "auto" | "named" | "milestone"; "label"?: string; "node": string }

export type NodeVersionCreateOutput = { "name": string; "node": string; "seq": number; "kind": string; "label": (string) | (null); "pinned": number; "actor": string; "size": number; "creation": (string) | (null) }

export type NodeVersionCreateError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict"

const operationNodeVersionCreate: Operation<NodeVersionCreateInput, NodeVersionCreateOutput, NodeVersionCreateError> = {
  id: "node_version_create",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/versions",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is NodeVersionCreateInput { assertSchema(value, {"type":"object","properties":{"kind":{"enum":["auto","named","milestone"],"title":"Kind","type":"string"},"label":{"title":"Label","type":"string"},"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_version_create input') },
  validateOutput(value): asserts value is NodeVersionCreateOutput { assertSchema(value, {"properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"seq":{"title":"Seq","type":"integer"},"kind":{"title":"Kind","type":"string"},"label":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Label"},"pinned":{"title":"Pinned","type":"integer"},"actor":{"title":"Actor","type":"string"},"size":{"title":"Size","type":"integer"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"}},"required":["name","node","seq","kind","label","pinned","actor","size","creation"],"title":"VersionShape","type":"object"}, 'node_version_create output') },
}

export type NodeVersionPatchInput = { "label"?: string; "pinned"?: boolean; "node": string; "seq": string }

export type NodeVersionPatchOutput = { "name": string; "node": string; "seq": number; "kind": string; "label": (string) | (null); "pinned": number; "actor": string; "size": number; "creation": (string) | (null) }

export type NodeVersionPatchError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict"

const operationNodeVersionPatch: Operation<NodeVersionPatchInput, NodeVersionPatchOutput, NodeVersionPatchError> = {
  id: "node_version_patch",
  owner: "drive",
  method: "PATCH",
  path: "nodes/{node}/versions/{seq}",
  prefix: "/api/suite/drive/",
  pathParams: ["node","seq"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is NodeVersionPatchInput { assertSchema(value, {"type":"object","properties":{"label":{"title":"Label","type":"string"},"pinned":{"title":"Pinned","type":"boolean"},"node":{"type":"string"},"seq":{"type":"string"}},"required":["node","seq"],"additionalProperties":false,"$defs":{}}, 'node_version_patch input') },
  validateOutput(value): asserts value is NodeVersionPatchOutput { assertSchema(value, {"properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"seq":{"title":"Seq","type":"integer"},"kind":{"title":"Kind","type":"string"},"label":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Label"},"pinned":{"title":"Pinned","type":"integer"},"actor":{"title":"Actor","type":"string"},"size":{"title":"Size","type":"integer"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"}},"required":["name","node","seq","kind","label","pinned","actor","size","creation"],"title":"VersionShape","type":"object"}, 'node_version_patch output') },
}

export type NodeVersionDeleteInput = { "node": string; "seq": string }

export type NodeVersionDeleteOutput = { "count": number }

export type NodeVersionDeleteError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict"

const operationNodeVersionDelete: Operation<NodeVersionDeleteInput, NodeVersionDeleteOutput, NodeVersionDeleteError> = {
  id: "node_version_delete",
  owner: "drive",
  method: "DELETE",
  path: "nodes/{node}/versions/{seq}",
  prefix: "/api/suite/drive/",
  pathParams: ["node","seq"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is NodeVersionDeleteInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"},"seq":{"type":"string"}},"required":["node","seq"],"additionalProperties":false,"$defs":{}}, 'node_version_delete input') },
  validateOutput(value): asserts value is NodeVersionDeleteOutput { assertSchema(value, {"description":"The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).","properties":{"count":{"title":"Count","type":"integer"}},"required":["count"],"title":"Count","type":"object"}, 'node_version_delete output') },
}

export type NodeVersionContentInput = { "node": string; "seq": string }

export type NodeVersionContentOutput = Blob

export type NodeVersionContentError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveConflict"

const operationNodeVersionContent: Operation<NodeVersionContentInput, NodeVersionContentOutput, NodeVersionContentError> = {
  id: "node_version_content",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/versions/{seq}/content",
  prefix: "/api/suite/drive/",
  pathParams: ["node","seq"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveConflict"],
  validateInput(value): asserts value is NodeVersionContentInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"},"seq":{"type":"string"}},"required":["node","seq"],"additionalProperties":false,"$defs":{}}, 'node_version_content input') },
  validateOutput(value): asserts value is NodeVersionContentOutput { void value },
}

export type NodeVersionRestoreInput = { "node": string; "seq": string }

export type NodeVersionRestoreOutput = ({ "name": string; "node": string; "seq": number; "kind": string; "label": (string) | (null); "pinned": number; "actor": string; "size": number; "creation": (string) | (null) }) | (null)

export type NodeVersionRestoreError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict"

const operationNodeVersionRestore: Operation<NodeVersionRestoreInput, NodeVersionRestoreOutput, NodeVersionRestoreError> = {
  id: "node_version_restore",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/versions/{seq}/restore",
  prefix: "/api/suite/drive/",
  pathParams: ["node","seq"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is NodeVersionRestoreInput { assertSchema(value, {"type":"object","properties":{"node":{"type":"string"},"seq":{"type":"string"}},"required":["node","seq"],"additionalProperties":false,"$defs":{}}, 'node_version_restore input') },
  validateOutput(value): asserts value is NodeVersionRestoreOutput { assertSchema(value, {"$defs":{"VersionShape":{"properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"seq":{"title":"Seq","type":"integer"},"kind":{"title":"Kind","type":"string"},"label":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Label"},"pinned":{"title":"Pinned","type":"integer"},"actor":{"title":"Actor","type":"string"},"size":{"title":"Size","type":"integer"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"}},"required":["name","node","seq","kind","label","pinned","actor","size","creation"],"title":"VersionShape","type":"object"}},"anyOf":[{"$ref":"#/$defs/VersionShape"},{"type":"null"}]}, 'node_version_restore output') },
}

export type NodeThreadsInput = { "resolved"?: boolean; "node": string }

export type NodeThreadsOutput = { "threads": Array<{ "name": string; "node": string; "anchor": string; "resolved": boolean; "resolved_by": (string) | (null); "resolved_at": (string) | (null); "creation": (string) | (null); "comments": Array<{ "name": string; "thread": string; "node": string; "content": string; "author": string; "author_name": (string) | (null); "person"?: { "id": string; "full_name": string; "user_image": (string) | (null) }; "mentions": Array<string>; "creation": (string) | (null); "modified": (string) | (null) }> }> }

export type NodeThreadsError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveConflict"

const operationNodeThreads: Operation<NodeThreadsInput, NodeThreadsOutput, NodeThreadsError> = {
  id: "node_threads",
  owner: "drive",
  method: "GET",
  path: "nodes/{node}/threads",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveConflict"],
  validateInput(value): asserts value is NodeThreadsInput { assertSchema(value, {"type":"object","properties":{"resolved":{"title":"Resolved","type":"boolean"},"node":{"type":"string"}},"required":["node"],"additionalProperties":false,"$defs":{}}, 'node_threads input') },
  validateOutput(value): asserts value is NodeThreadsOutput { assertSchema(value, {"$defs":{"CommentShape":{"properties":{"name":{"title":"Name","type":"string"},"thread":{"title":"Thread","type":"string"},"node":{"title":"Node","type":"string"},"content":{"title":"Content","type":"string"},"author":{"title":"Author","type":"string"},"author_name":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Author Name"},"person":{"$ref":"#/$defs/Person"},"mentions":{"items":{"type":"string"},"title":"Mentions","type":"array"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"}},"required":["name","thread","node","content","author","author_name","mentions","creation","modified"],"title":"CommentShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"},"ThreadShape":{"properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"anchor":{"title":"Anchor","type":"string"},"resolved":{"title":"Resolved","type":"boolean"},"resolved_by":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Resolved By"},"resolved_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Resolved At"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"comments":{"items":{"$ref":"#/$defs/CommentShape"},"title":"Comments","type":"array"}},"required":["name","node","anchor","resolved","resolved_by","resolved_at","creation","comments"],"title":"ThreadShape","type":"object"}},"properties":{"threads":{"items":{"$ref":"#/$defs/ThreadShape"},"title":"Threads","type":"array"}},"required":["threads"],"title":"ThreadList","type":"object"}, 'node_threads output') },
}

export type NodeThreadCreateInput = { "anchor": string; "text": string; "author_name"?: string; "node": string }

export type NodeThreadCreateOutput = { "name": string; "node": string; "anchor": string; "resolved": boolean; "resolved_by": (string) | (null); "resolved_at": (string) | (null); "creation": (string) | (null); "comments": Array<{ "name": string; "thread": string; "node": string; "content": string; "author": string; "author_name": (string) | (null); "person"?: { "id": string; "full_name": string; "user_image": (string) | (null) }; "mentions": Array<string>; "creation": (string) | (null); "modified": (string) | (null) }> }

export type NodeThreadCreateError = "DriveNotFound" | "DriveLocked" | "DriveLinkExpired" | "DriveForbidden" | "DriveConflict"

const operationNodeThreadCreate: Operation<NodeThreadCreateInput, NodeThreadCreateOutput, NodeThreadCreateError> = {
  id: "node_thread_create",
  owner: "drive",
  method: "POST",
  path: "nodes/{node}/threads",
  prefix: "/api/suite/drive/",
  pathParams: ["node"],
  nodeParams: ["node"],
  entity: null,
  errors: ["DriveNotFound","DriveLocked","DriveLinkExpired","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is NodeThreadCreateInput { assertSchema(value, {"type":"object","properties":{"anchor":{"title":"Anchor","type":"string"},"text":{"title":"Text","type":"string"},"author_name":{"title":"Author Name","type":"string"},"node":{"type":"string"}},"required":["anchor","text","node"],"additionalProperties":false,"$defs":{}}, 'node_thread_create input') },
  validateOutput(value): asserts value is NodeThreadCreateOutput { assertSchema(value, {"$defs":{"CommentShape":{"properties":{"name":{"title":"Name","type":"string"},"thread":{"title":"Thread","type":"string"},"node":{"title":"Node","type":"string"},"content":{"title":"Content","type":"string"},"author":{"title":"Author","type":"string"},"author_name":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Author Name"},"person":{"$ref":"#/$defs/Person"},"mentions":{"items":{"type":"string"},"title":"Mentions","type":"array"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"}},"required":["name","thread","node","content","author","author_name","mentions","creation","modified"],"title":"CommentShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"anchor":{"title":"Anchor","type":"string"},"resolved":{"title":"Resolved","type":"boolean"},"resolved_by":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Resolved By"},"resolved_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Resolved At"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"comments":{"items":{"$ref":"#/$defs/CommentShape"},"title":"Comments","type":"array"}},"required":["name","node","anchor","resolved","resolved_by","resolved_at","creation","comments"],"title":"ThreadShape","type":"object"}, 'node_thread_create output') },
}

export type ThreadPatchInput = { "resolved": boolean; "thread": string }

export type ThreadPatchOutput = { "name": string; "node": string; "anchor": string; "resolved": boolean; "resolved_by": (string) | (null); "resolved_at": (string) | (null); "creation": (string) | (null); "comments": Array<{ "name": string; "thread": string; "node": string; "content": string; "author": string; "author_name": (string) | (null); "person"?: { "id": string; "full_name": string; "user_image": (string) | (null) }; "mentions": Array<string>; "creation": (string) | (null); "modified": (string) | (null) }> }

export type ThreadPatchError = "DriveNotFound" | "DriveForbidden" | "DriveConflict"

const operationThreadPatch: Operation<ThreadPatchInput, ThreadPatchOutput, ThreadPatchError> = {
  id: "thread_patch",
  owner: "drive",
  method: "PATCH",
  path: "threads/{thread}",
  prefix: "/api/suite/drive/",
  pathParams: ["thread"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is ThreadPatchInput { assertSchema(value, {"type":"object","properties":{"resolved":{"title":"Resolved","type":"boolean"},"thread":{"type":"string"}},"required":["resolved","thread"],"additionalProperties":false,"$defs":{}}, 'thread_patch input') },
  validateOutput(value): asserts value is ThreadPatchOutput { assertSchema(value, {"$defs":{"CommentShape":{"properties":{"name":{"title":"Name","type":"string"},"thread":{"title":"Thread","type":"string"},"node":{"title":"Node","type":"string"},"content":{"title":"Content","type":"string"},"author":{"title":"Author","type":"string"},"author_name":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Author Name"},"person":{"$ref":"#/$defs/Person"},"mentions":{"items":{"type":"string"},"title":"Mentions","type":"array"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"}},"required":["name","thread","node","content","author","author_name","mentions","creation","modified"],"title":"CommentShape","type":"object"},"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"anchor":{"title":"Anchor","type":"string"},"resolved":{"title":"Resolved","type":"boolean"},"resolved_by":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Resolved By"},"resolved_at":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Resolved At"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"comments":{"items":{"$ref":"#/$defs/CommentShape"},"title":"Comments","type":"array"}},"required":["name","node","anchor","resolved","resolved_by","resolved_at","creation","comments"],"title":"ThreadShape","type":"object"}, 'thread_patch output') },
}

export type ThreadCommentCreateInput = { "text": string; "author_name"?: string; "thread": string }

export type ThreadCommentCreateOutput = { "name": string; "thread": string; "node": string; "content": string; "author": string; "author_name": (string) | (null); "person"?: { "id": string; "full_name": string; "user_image": (string) | (null) }; "mentions": Array<string>; "creation": (string) | (null); "modified": (string) | (null) }

export type ThreadCommentCreateError = "DriveNotFound" | "DriveForbidden" | "DriveConflict"

const operationThreadCommentCreate: Operation<ThreadCommentCreateInput, ThreadCommentCreateOutput, ThreadCommentCreateError> = {
  id: "thread_comment_create",
  owner: "drive",
  method: "POST",
  path: "threads/{thread}/comments",
  prefix: "/api/suite/drive/",
  pathParams: ["thread"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is ThreadCommentCreateInput { assertSchema(value, {"type":"object","properties":{"text":{"title":"Text","type":"string"},"author_name":{"title":"Author Name","type":"string"},"thread":{"type":"string"}},"required":["text","thread"],"additionalProperties":false,"$defs":{}}, 'thread_comment_create input') },
  validateOutput(value): asserts value is ThreadCommentCreateOutput { assertSchema(value, {"$defs":{"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"thread":{"title":"Thread","type":"string"},"node":{"title":"Node","type":"string"},"content":{"title":"Content","type":"string"},"author":{"title":"Author","type":"string"},"author_name":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Author Name"},"person":{"$ref":"#/$defs/Person"},"mentions":{"items":{"type":"string"},"title":"Mentions","type":"array"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"}},"required":["name","thread","node","content","author","author_name","mentions","creation","modified"],"title":"CommentShape","type":"object"}, 'thread_comment_create output') },
}

export type CommentPatchInput = { "text": string; "comment": string }

export type CommentPatchOutput = { "name": string; "thread": string; "node": string; "content": string; "author": string; "author_name": (string) | (null); "person"?: { "id": string; "full_name": string; "user_image": (string) | (null) }; "mentions": Array<string>; "creation": (string) | (null); "modified": (string) | (null) }

export type CommentPatchError = "DriveNotFound" | "DriveForbidden" | "DriveConflict"

const operationCommentPatch: Operation<CommentPatchInput, CommentPatchOutput, CommentPatchError> = {
  id: "comment_patch",
  owner: "drive",
  method: "PATCH",
  path: "comments/{comment}",
  prefix: "/api/suite/drive/",
  pathParams: ["comment"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is CommentPatchInput { assertSchema(value, {"type":"object","properties":{"text":{"title":"Text","type":"string"},"comment":{"type":"string"}},"required":["text","comment"],"additionalProperties":false,"$defs":{}}, 'comment_patch input') },
  validateOutput(value): asserts value is CommentPatchOutput { assertSchema(value, {"$defs":{"Person":{"properties":{"id":{"title":"Id","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"}},"required":["id","full_name","user_image"],"title":"Person","type":"object"}},"properties":{"name":{"title":"Name","type":"string"},"thread":{"title":"Thread","type":"string"},"node":{"title":"Node","type":"string"},"content":{"title":"Content","type":"string"},"author":{"title":"Author","type":"string"},"author_name":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Author Name"},"person":{"$ref":"#/$defs/Person"},"mentions":{"items":{"type":"string"},"title":"Mentions","type":"array"},"creation":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Creation"},"modified":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Modified"}},"required":["name","thread","node","content","author","author_name","mentions","creation","modified"],"title":"CommentShape","type":"object"}, 'comment_patch output') },
}

export type CommentDeleteInput = { "comment": string }

export type CommentDeleteOutput = { "count": number }

export type CommentDeleteError = "DriveNotFound" | "DriveForbidden" | "DriveConflict"

const operationCommentDelete: Operation<CommentDeleteInput, CommentDeleteOutput, CommentDeleteError> = {
  id: "comment_delete",
  owner: "drive",
  method: "DELETE",
  path: "comments/{comment}",
  prefix: "/api/suite/drive/",
  pathParams: ["comment"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is CommentDeleteInput { assertSchema(value, {"type":"object","properties":{"comment":{"type":"string"}},"required":["comment"],"additionalProperties":false,"$defs":{}}, 'comment_delete input') },
  validateOutput(value): asserts value is CommentDeleteOutput { assertSchema(value, {"description":"The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).","properties":{"count":{"title":"Count","type":"integer"}},"required":["count"],"title":"Count","type":"object"}, 'comment_delete output') },
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

export type NotificationsReadNotificationNamesOutput = { "count": number }

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
  validateOutput(value): asserts value is NotificationsReadNotificationNamesOutput { assertSchema(value, {"description":"The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).","properties":{"count":{"title":"Count","type":"integer"}},"required":["count"],"title":"Count","type":"object"}, 'notifications_read.notification_names output') },
}

export type NotificationsReadAllNotificationsInput = { "all": true }

export type NotificationsReadAllNotificationsOutput = { "count": number }

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
  validateOutput(value): asserts value is NotificationsReadAllNotificationsOutput { assertSchema(value, {"description":"The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).","properties":{"count":{"title":"Count","type":"integer"}},"required":["count"],"title":"Count","type":"object"}, 'notifications_read.all_notifications output') },
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

export type RootUsageInput = { "expand"?: "breakdown"; "root": string }

export type RootUsageOutput = { "used_bytes": number; "reserved_bytes": number; "quota_bytes": (number) | (null); "effective_quota": number; "by_type"?: Array<{ "type": string; "bytes": number }>; "largest"?: Array<{ "node": string; "title": string; "size": number; "mime": (string) | (null); "kind": "file" | "document"; "type": string }> }

export type RootUsageError = "DriveNotFound" | "DriveForbidden"

const operationRootUsage: Operation<RootUsageInput, RootUsageOutput, RootUsageError> = {
  id: "root_usage",
  owner: "drive",
  method: "GET",
  path: "roots/{root}/usage",
  prefix: "/api/suite/drive/",
  pathParams: ["root"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden"],
  validateInput(value): asserts value is RootUsageInput { assertSchema(value, {"type":"object","properties":{"expand":{"const":"breakdown","title":"Expand","type":"string"},"root":{"type":"string"}},"required":["root"],"additionalProperties":false,"$defs":{}}, 'root_usage input') },
  validateOutput(value): asserts value is RootUsageOutput { assertSchema(value, {"$defs":{"LargestNode":{"properties":{"node":{"title":"Node","type":"string"},"title":{"title":"Title","type":"string"},"size":{"title":"Size","type":"integer"},"mime":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Mime"},"kind":{"enum":["file","document"],"title":"Kind","type":"string"},"type":{"title":"Type","type":"string"}},"required":["node","title","size","mime","kind","type"],"title":"LargestNode","type":"object"},"TypeBytes":{"properties":{"type":{"title":"Type","type":"string"},"bytes":{"title":"Bytes","type":"integer"}},"required":["type","bytes"],"title":"TypeBytes","type":"object"}},"properties":{"used_bytes":{"title":"Used Bytes","type":"integer"},"reserved_bytes":{"title":"Reserved Bytes","type":"integer"},"quota_bytes":{"anyOf":[{"type":"integer"},{"type":"null"}],"title":"Quota Bytes"},"effective_quota":{"title":"Effective Quota","type":"integer"},"by_type":{"items":{"$ref":"#/$defs/TypeBytes"},"title":"By Type","type":"array"},"largest":{"items":{"$ref":"#/$defs/LargestNode"},"title":"Largest","type":"array"}},"required":["used_bytes","reserved_bytes","quota_bytes","effective_quota"],"title":"RootUsage","type":"object"}, 'root_usage output') },
}

export type RootPatchRootQuotaInput = { "quota_bytes": number; "root": string }

export type RootPatchRootQuotaOutput = { "name": string; "node": string; "kind": string; "user": (string) | (null); "state": string; "quota_bytes": number; "used_bytes": number; "title": string }

export type RootPatchRootQuotaError = "DriveNotFound" | "DriveForbidden" | "DriveConflict"

const operationRootPatchRootQuota: Operation<RootPatchRootQuotaInput, RootPatchRootQuotaOutput, RootPatchRootQuotaError> = {
  id: "root_patch.root_quota",
  owner: "drive",
  method: "PATCH",
  path: "roots/{root}",
  prefix: "/api/suite/drive/",
  pathParams: ["root"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is RootPatchRootQuotaInput { assertSchema(value, {"type":"object","properties":{"quota_bytes":{"title":"Quota Bytes","type":"integer"},"root":{"type":"string"}},"required":["quota_bytes","root"],"additionalProperties":false,"$defs":{}}, 'root_patch.root_quota input') },
  validateOutput(value): asserts value is RootPatchRootQuotaOutput { assertSchema(value, {"description":"One `Drive Root` with its node's title, as `PATCH /roots/<id>` answers it.","properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"kind":{"title":"Kind","type":"string"},"user":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User"},"state":{"title":"State","type":"string"},"quota_bytes":{"title":"Quota Bytes","type":"integer"},"used_bytes":{"title":"Used Bytes","type":"integer"},"title":{"title":"Title","type":"string"}},"required":["name","node","kind","user","state","quota_bytes","used_bytes","title"],"title":"RootShape","type":"object"}, 'root_patch.root_quota output') },
}

export type RootPatchRootArchiveInput = { "state": "Archived"; "root": string }

export type RootPatchRootArchiveOutput = { "name": string; "node": string; "kind": string; "user": (string) | (null); "state": string; "quota_bytes": number; "used_bytes": number; "title": string }

export type RootPatchRootArchiveError = "DriveNotFound" | "DriveForbidden" | "DriveConflict"

const operationRootPatchRootArchive: Operation<RootPatchRootArchiveInput, RootPatchRootArchiveOutput, RootPatchRootArchiveError> = {
  id: "root_patch.root_archive",
  owner: "drive",
  method: "PATCH",
  path: "roots/{root}",
  prefix: "/api/suite/drive/",
  pathParams: ["root"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is RootPatchRootArchiveInput { assertSchema(value, {"type":"object","properties":{"state":{"const":"Archived","title":"State","type":"string"},"root":{"type":"string"}},"required":["state","root"],"additionalProperties":false,"$defs":{}}, 'root_patch.root_archive input') },
  validateOutput(value): asserts value is RootPatchRootArchiveOutput { assertSchema(value, {"description":"One `Drive Root` with its node's title, as `PATCH /roots/<id>` answers it.","properties":{"name":{"title":"Name","type":"string"},"node":{"title":"Node","type":"string"},"kind":{"title":"Kind","type":"string"},"user":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User"},"state":{"title":"State","type":"string"},"quota_bytes":{"title":"Quota Bytes","type":"integer"},"used_bytes":{"title":"Used Bytes","type":"integer"},"title":{"title":"Title","type":"string"}},"required":["name","node","kind","user","state","quota_bytes","used_bytes","title"],"title":"RootShape","type":"object"}, 'root_patch.root_archive output') },
}

export type RootPurgeInput = { "root": string }

export type RootPurgeOutput = { "count": number }

export type RootPurgeError = "DriveNotFound" | "DriveForbidden" | "DriveConflict"

const operationRootPurge: Operation<RootPurgeInput, RootPurgeOutput, RootPurgeError> = {
  id: "root_purge",
  owner: "drive",
  method: "DELETE",
  path: "roots/{root}",
  prefix: "/api/suite/drive/",
  pathParams: ["root"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is RootPurgeInput { assertSchema(value, {"type":"object","properties":{"root":{"type":"string"}},"required":["root"],"additionalProperties":false,"$defs":{}}, 'root_purge input') },
  validateOutput(value): asserts value is RootPurgeOutput { assertSchema(value, {"description":"The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).","properties":{"count":{"title":"Count","type":"integer"}},"required":["count"],"title":"Count","type":"object"}, 'root_purge output') },
}

export type RootEmptyTrashInput = { "root": string }

export type RootEmptyTrashOutput = { "count": number }

export type RootEmptyTrashError = "DriveNotFound" | "DriveForbidden" | "DriveConflict"

const operationRootEmptyTrash: Operation<RootEmptyTrashInput, RootEmptyTrashOutput, RootEmptyTrashError> = {
  id: "root_empty_trash",
  owner: "drive",
  method: "POST",
  path: "roots/{root}/trash/empty",
  prefix: "/api/suite/drive/",
  pathParams: ["root"],
  nodeParams: [],
  entity: null,
  errors: ["DriveNotFound","DriveForbidden","DriveConflict"],
  validateInput(value): asserts value is RootEmptyTrashInput { assertSchema(value, {"type":"object","properties":{"root":{"type":"string"}},"required":["root"],"additionalProperties":false,"$defs":{}}, 'root_empty_trash input') },
  validateOutput(value): asserts value is RootEmptyTrashOutput { assertSchema(value, {"description":"The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).","properties":{"count":{"title":"Count","type":"integer"}},"required":["count"],"title":"Count","type":"object"}, 'root_empty_trash output') },
}

export type SettingsGetInput = Record<string, never>

export type SettingsGetOutput = { "webdav_enabled": boolean; "writer_settings": {  } }

export type SettingsGetError = never

const operationSettingsGet: Operation<SettingsGetInput, SettingsGetOutput, SettingsGetError> = {
  id: "settings_get",
  owner: "drive",
  method: "GET",
  path: "settings",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is SettingsGetInput { assertSchema(value, {"type":"object","properties":{},"required":[],"additionalProperties":false,"$defs":{}}, 'settings_get input') },
  validateOutput(value): asserts value is SettingsGetOutput { assertSchema(value, {"description":"The caller's own `Drive Settings` row (§3.14), or its field defaults.","properties":{"webdav_enabled":{"title":"Webdav Enabled","type":"boolean"},"writer_settings":{"additionalProperties":true,"title":"Writer Settings","type":"object"}},"required":["webdav_enabled","writer_settings"],"title":"UserSettings","type":"object"}, 'settings_get output') },
}

export type SettingsPatchInput = { "webdav_enabled": boolean }

export type SettingsPatchOutput = { "webdav_enabled": boolean; "writer_settings": {  } }

export type SettingsPatchError = never

const operationSettingsPatch: Operation<SettingsPatchInput, SettingsPatchOutput, SettingsPatchError> = {
  id: "settings_patch",
  owner: "drive",
  method: "PATCH",
  path: "settings",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is SettingsPatchInput { assertSchema(value, {"type":"object","properties":{"webdav_enabled":{"title":"Webdav Enabled","type":"boolean"}},"required":["webdav_enabled"],"additionalProperties":false,"$defs":{}}, 'settings_patch input') },
  validateOutput(value): asserts value is SettingsPatchOutput { assertSchema(value, {"description":"The caller's own `Drive Settings` row (§3.14), or its field defaults.","properties":{"webdav_enabled":{"title":"Webdav Enabled","type":"boolean"},"writer_settings":{"additionalProperties":true,"title":"Writer Settings","type":"object"}},"required":["webdav_enabled","writer_settings"],"title":"UserSettings","type":"object"}, 'settings_patch output') },
}

export type SiteSettingsGetInput = Record<string, never>

export type SiteSettingsGetOutput = ({ "is_admin": boolean; "preview_size": number }) | ({ "is_admin": boolean; "preview_size": number; "webdav_enabled": boolean; "webdav_allowed_methods": string; "default_personal_quota": number; "shared_quota": number })

export type SiteSettingsGetError = never

const operationSiteSettingsGet: Operation<SiteSettingsGetInput, SiteSettingsGetOutput, SiteSettingsGetError> = {
  id: "site_settings_get",
  owner: "drive",
  method: "GET",
  path: "site-settings",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is SiteSettingsGetInput { assertSchema(value, {"type":"object","properties":{},"required":[],"additionalProperties":false,"$defs":{}}, 'site_settings_get input') },
  validateOutput(value): asserts value is SiteSettingsGetOutput { assertSchema(value, {"$defs":{"AdminSiteSettings":{"description":"What a Drive admin reads. Quotas are bytes, and 0 is unlimited.","properties":{"is_admin":{"title":"Is Admin","type":"boolean"},"preview_size":{"title":"Preview Size","type":"integer"},"webdav_enabled":{"title":"Webdav Enabled","type":"boolean"},"webdav_allowed_methods":{"title":"Webdav Allowed Methods","type":"string"},"default_personal_quota":{"title":"Default Personal Quota","type":"integer"},"shared_quota":{"title":"Shared Quota","type":"integer"}},"required":["is_admin","preview_size","webdav_enabled","webdav_allowed_methods","default_personal_quota","shared_quota"],"title":"AdminSiteSettings","type":"object"},"SiteSettings":{"description":"What every signed-in caller reads from `Drive Disk Settings` (§3.13).","properties":{"is_admin":{"title":"Is Admin","type":"boolean"},"preview_size":{"title":"Preview Size","type":"integer"}},"required":["is_admin","preview_size"],"title":"SiteSettings","type":"object"}},"anyOf":[{"$ref":"#/$defs/SiteSettings"},{"$ref":"#/$defs/AdminSiteSettings"}]}, 'site_settings_get output') },
}

export type SiteSettingsPatchInput = { "webdav_enabled": boolean }

export type SiteSettingsPatchOutput = { "is_admin": boolean; "preview_size": number; "webdav_enabled": boolean; "webdav_allowed_methods": string; "default_personal_quota": number; "shared_quota": number }

export type SiteSettingsPatchError = "DriveForbidden"

const operationSiteSettingsPatch: Operation<SiteSettingsPatchInput, SiteSettingsPatchOutput, SiteSettingsPatchError> = {
  id: "site_settings_patch",
  owner: "drive",
  method: "PATCH",
  path: "site-settings",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["DriveForbidden"],
  validateInput(value): asserts value is SiteSettingsPatchInput { assertSchema(value, {"type":"object","properties":{"webdav_enabled":{"title":"Webdav Enabled","type":"boolean"}},"required":["webdav_enabled"],"additionalProperties":false,"$defs":{}}, 'site_settings_patch input') },
  validateOutput(value): asserts value is SiteSettingsPatchOutput { assertSchema(value, {"description":"What a Drive admin reads. Quotas are bytes, and 0 is unlimited.","properties":{"is_admin":{"title":"Is Admin","type":"boolean"},"preview_size":{"title":"Preview Size","type":"integer"},"webdav_enabled":{"title":"Webdav Enabled","type":"boolean"},"webdav_allowed_methods":{"title":"Webdav Allowed Methods","type":"string"},"default_personal_quota":{"title":"Default Personal Quota","type":"integer"},"shared_quota":{"title":"Shared Quota","type":"integer"}},"required":["is_admin","preview_size","webdav_enabled","webdav_allowed_methods","default_personal_quota","shared_quota"],"title":"AdminSiteSettings","type":"object"}, 'site_settings_patch output') },
}

export type WebdavGetInput = Record<string, never>

export type WebdavGetOutput = (Record<string, never>) | ({ "globally_enabled": boolean; "is_admin": boolean }) | ({ "globally_enabled": boolean; "is_admin": boolean; "server_url": string; "username": string; "enabled_for_user": boolean; "two_factor_blocked": boolean; "api_key": (string) | (null) })

export type WebdavGetError = never

const operationWebdavGet: Operation<WebdavGetInput, WebdavGetOutput, WebdavGetError> = {
  id: "webdav_get",
  owner: "drive",
  method: "GET",
  path: "webdav",
  prefix: "/api/suite/drive/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is WebdavGetInput { assertSchema(value, {"type":"object","properties":{},"required":[],"additionalProperties":false,"$defs":{}}, 'webdav_get input') },
  validateOutput(value): asserts value is WebdavGetOutput { assertSchema(value, {"$defs":{"WebdavConnection":{"additionalProperties":false,"description":"How to mount `/dav/` while the site switch is on. Closed, as `WebdavOff`.\n\n`api_key` doubles as the DAV username for key-based sign-in. The secret is\nminted once by `suite.utils.user.generate_user_keys` and never read back.","properties":{"globally_enabled":{"title":"Globally Enabled","type":"boolean"},"is_admin":{"title":"Is Admin","type":"boolean"},"server_url":{"title":"Server Url","type":"string"},"username":{"title":"Username","type":"string"},"enabled_for_user":{"title":"Enabled For User","type":"boolean"},"two_factor_blocked":{"title":"Two Factor Blocked","type":"boolean"},"api_key":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Api Key"}},"required":["globally_enabled","is_admin","server_url","username","enabled_for_user","two_factor_blocked","api_key"],"title":"WebdavConnection","type":"object"},"WebdavHidden":{"additionalProperties":false,"description":"WebDAV is off for the site and the caller is no admin: nothing to show.","properties":{},"title":"WebdavHidden","type":"object"},"WebdavOff":{"additionalProperties":false,"description":"The site switch, shown to an admin while it is off.","properties":{"globally_enabled":{"title":"Globally Enabled","type":"boolean"},"is_admin":{"title":"Is Admin","type":"boolean"}},"required":["globally_enabled","is_admin"],"title":"WebdavOff","type":"object"}},"anyOf":[{"$ref":"#/$defs/WebdavHidden"},{"$ref":"#/$defs/WebdavOff"},{"$ref":"#/$defs/WebdavConnection"}]}, 'webdav_get output') },
}

export const api = {
  "node_create": {
    "create_folder": operationNodeCreateCreateFolder,
    "create_file": operationNodeCreateCreateFile,
    "create_link": operationNodeCreateCreateLink,
    "create_document": operationNodeCreateCreateDocument
  },
  "node_batch": operationNodeBatch,
  "node_batch_purge": operationNodeBatchPurge,
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
  "grant_patch": operationGrantPatch,
  "grant_delete": operationGrantDelete,
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
  "root_patch": {
    "root_quota": operationRootPatchRootQuota,
    "root_archive": operationRootPatchRootArchive
  },
  "root_purge": operationRootPurge,
  "root_empty_trash": operationRootEmptyTrash,
  "settings_get": operationSettingsGet,
  "settings_patch": operationSettingsPatch,
  "site_settings_get": operationSiteSettingsGet,
  "site_settings_patch": operationSiteSettingsPatch,
  "webdav_get": operationWebdavGet
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
    for (const key of schema.required ?? []) if (record[key] === undefined) throw new TypeError(label + '.' + key + ' is required')
    if (schema.additionalProperties === false) for (const key of Object.keys(record)) if (!(key in (schema.properties ?? {}))) throw new TypeError(label + '.' + key + ' is not allowed')
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (record[key] !== undefined) assertSchema(record[key], child, label + '.' + key, root)
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
