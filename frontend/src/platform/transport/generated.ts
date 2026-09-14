// Generated from src/platform/transport/contract.json. Do not edit.
import type { Operation } from '@/platform/transport'

export type AccountGetInput = Record<string, never>

export type AccountGetOutput = ({ "name": string; "email": string; "full_name": string; "avatar": (string) | (null); "roles": { "system_manager": boolean }; "is_jmap_configured": boolean }) | (null)

export type AccountGetError = never

const operationAccountGet: Operation<AccountGetInput, AccountGetOutput, AccountGetError> = {
  id: "account_get",
  owner: "suite",
  method: "GET",
  path: "account",
  prefix: "/api/suite/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is AccountGetInput { assertSchema(value, {"type":"object","properties":{},"required":[],"additionalProperties":false,"$defs":{}}, 'account_get input') },
  validateOutput(value): asserts value is AccountGetOutput { assertSchema(value, {"$defs":{"Account":{"properties":{"name":{"title":"Name","type":"string"},"email":{"title":"Email","type":"string"},"full_name":{"title":"Full Name","type":"string"},"avatar":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Avatar"},"roles":{"$ref":"#/$defs/AccountRoles"},"is_jmap_configured":{"title":"Is Jmap Configured","type":"boolean"}},"required":["name","email","full_name","avatar","roles","is_jmap_configured"],"title":"Account","type":"object"},"AccountRoles":{"properties":{"system_manager":{"title":"System Manager","type":"boolean"}},"required":["system_manager"],"title":"AccountRoles","type":"object"}},"anyOf":[{"$ref":"#/$defs/Account"},{"type":"null"}]}, 'account_get output') },
}

export type SiteGetInput = Record<string, never>

export type SiteGetOutput = { "is_onboarded": boolean; "can_onboard": boolean; "workspace_name": string; "workspace_logo": string }

export type SiteGetError = never

const operationSiteGet: Operation<SiteGetInput, SiteGetOutput, SiteGetError> = {
  id: "site_get",
  owner: "suite",
  method: "GET",
  path: "site",
  prefix: "/api/suite/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  validateInput(value): asserts value is SiteGetInput { assertSchema(value, {"type":"object","properties":{},"required":[],"additionalProperties":false,"$defs":{}}, 'site_get input') },
  validateOutput(value): asserts value is SiteGetOutput { assertSchema(value, {"properties":{"is_onboarded":{"title":"Is Onboarded","type":"boolean"},"can_onboard":{"title":"Can Onboard","type":"boolean"},"workspace_name":{"title":"Workspace Name","type":"string"},"workspace_logo":{"title":"Workspace Logo","type":"string"}},"required":["is_onboarded","can_onboard","workspace_name","workspace_logo"],"title":"Site","type":"object"}, 'site_get output') },
}

export type SitePatchCompleteOnboardingInput = { "is_onboarded": true; "timezone"?: string }

export type SitePatchCompleteOnboardingOutput = { "is_onboarded": boolean; "can_onboard": boolean; "workspace_name": string; "workspace_logo": string }

export type SitePatchCompleteOnboardingError = "BadRequest" | "PermissionError"

const operationSitePatchCompleteOnboarding: Operation<SitePatchCompleteOnboardingInput, SitePatchCompleteOnboardingOutput, SitePatchCompleteOnboardingError> = {
  id: "site_patch.complete_onboarding",
  owner: "suite",
  method: "PATCH",
  path: "site",
  prefix: "/api/suite/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["BadRequest","PermissionError"],
  validateInput(value): asserts value is SitePatchCompleteOnboardingInput { assertSchema(value, {"type":"object","properties":{"is_onboarded":{"const":true,"title":"Is Onboarded","type":"boolean"},"timezone":{"title":"Timezone","type":"string"}},"required":["is_onboarded"],"additionalProperties":false,"$defs":{}}, 'site_patch.complete_onboarding input') },
  validateOutput(value): asserts value is SitePatchCompleteOnboardingOutput { assertSchema(value, {"properties":{"is_onboarded":{"title":"Is Onboarded","type":"boolean"},"can_onboard":{"title":"Can Onboard","type":"boolean"},"workspace_name":{"title":"Workspace Name","type":"string"},"workspace_logo":{"title":"Workspace Logo","type":"string"}},"required":["is_onboarded","can_onboard","workspace_name","workspace_logo"],"title":"Site","type":"object"}, 'site_patch.complete_onboarding output') },
}

export type SitePatchUpdateSiteSettingsInput = { "workspace_name": string; "workspace_logo"?: string }

export type SitePatchUpdateSiteSettingsOutput = { "is_onboarded": boolean; "can_onboard": boolean; "workspace_name": string; "workspace_logo": string }

export type SitePatchUpdateSiteSettingsError = "BadRequest" | "PermissionError"

const operationSitePatchUpdateSiteSettings: Operation<SitePatchUpdateSiteSettingsInput, SitePatchUpdateSiteSettingsOutput, SitePatchUpdateSiteSettingsError> = {
  id: "site_patch.update_site_settings",
  owner: "suite",
  method: "PATCH",
  path: "site",
  prefix: "/api/suite/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["BadRequest","PermissionError"],
  validateInput(value): asserts value is SitePatchUpdateSiteSettingsInput { assertSchema(value, {"type":"object","properties":{"workspace_name":{"title":"Workspace Name","type":"string"},"workspace_logo":{"title":"Workspace Logo","type":"string"}},"required":["workspace_name"],"additionalProperties":false,"$defs":{}}, 'site_patch.update_site_settings input') },
  validateOutput(value): asserts value is SitePatchUpdateSiteSettingsOutput { assertSchema(value, {"properties":{"is_onboarded":{"title":"Is Onboarded","type":"boolean"},"can_onboard":{"title":"Can Onboard","type":"boolean"},"workspace_name":{"title":"Workspace Name","type":"string"},"workspace_logo":{"title":"Workspace Logo","type":"string"}},"required":["is_onboarded","can_onboard","workspace_name","workspace_logo"],"title":"Site","type":"object"}, 'site_patch.update_site_settings output') },
}

export type UsersGetInput = Record<string, never>

export type UsersGetOutput = Array<{ "name": string; "email": string; "full_name": string; "user_image": (string) | (null); "is_admin": boolean }>

export type UsersGetError = "PermissionError"

const operationUsersGet: Operation<UsersGetInput, UsersGetOutput, UsersGetError> = {
  id: "users_get",
  owner: "suite",
  method: "GET",
  path: "users",
  prefix: "/api/suite/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["PermissionError"],
  validateInput(value): asserts value is UsersGetInput { assertSchema(value, {"type":"object","properties":{},"required":[],"additionalProperties":false,"$defs":{}}, 'users_get input') },
  validateOutput(value): asserts value is UsersGetOutput { assertSchema(value, {"$defs":{"User":{"properties":{"name":{"title":"Name","type":"string"},"email":{"title":"Email","type":"string"},"full_name":{"title":"Full Name","type":"string"},"user_image":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"User Image"},"is_admin":{"title":"Is Admin","type":"boolean"}},"required":["name","email","full_name","user_image","is_admin"],"title":"User","type":"object"}},"items":{"$ref":"#/$defs/User"},"type":"array"}, 'users_get output') },
}

export type InvitationsGetInput = Record<string, never>

export type InvitationsGetOutput = Array<{ "name": string; "email": string; "creation": string; "invited_by": string; "invited_by_name": (string) | (null) }>

export type InvitationsGetError = "PermissionError"

const operationInvitationsGet: Operation<InvitationsGetInput, InvitationsGetOutput, InvitationsGetError> = {
  id: "invitations_get",
  owner: "suite",
  method: "GET",
  path: "invitations",
  prefix: "/api/suite/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["PermissionError"],
  validateInput(value): asserts value is InvitationsGetInput { assertSchema(value, {"type":"object","properties":{},"required":[],"additionalProperties":false,"$defs":{}}, 'invitations_get input') },
  validateOutput(value): asserts value is InvitationsGetOutput { assertSchema(value, {"$defs":{"Invitation":{"properties":{"name":{"title":"Name","type":"string"},"email":{"title":"Email","type":"string"},"creation":{"title":"Creation","type":"string"},"invited_by":{"title":"Invited By","type":"string"},"invited_by_name":{"anyOf":[{"type":"string"},{"type":"null"}],"title":"Invited By Name"}},"required":["name","email","creation","invited_by","invited_by_name"],"title":"Invitation","type":"object"}},"items":{"$ref":"#/$defs/Invitation"},"type":"array"}, 'invitations_get output') },
}

export type InvitationsPostInput = { "emails": string }

export type InvitationsPostOutput = { "disabled_user_emails": Array<string>; "accepted_invite_emails": Array<string>; "pending_invite_emails": Array<string>; "invited_emails": Array<string> }

export type InvitationsPostError = "BadRequest" | "PermissionError"

const operationInvitationsPost: Operation<InvitationsPostInput, InvitationsPostOutput, InvitationsPostError> = {
  id: "invitations_post",
  owner: "suite",
  method: "POST",
  path: "invitations",
  prefix: "/api/suite/",
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ["BadRequest","PermissionError"],
  validateInput(value): asserts value is InvitationsPostInput { assertSchema(value, {"type":"object","properties":{"emails":{"title":"Emails","type":"string"}},"required":["emails"],"additionalProperties":false,"$defs":{}}, 'invitations_post input') },
  validateOutput(value): asserts value is InvitationsPostOutput { assertSchema(value, {"properties":{"disabled_user_emails":{"items":{"type":"string"},"title":"Disabled User Emails","type":"array"},"accepted_invite_emails":{"items":{"type":"string"},"title":"Accepted Invite Emails","type":"array"},"pending_invite_emails":{"items":{"type":"string"},"title":"Pending Invite Emails","type":"array"},"invited_emails":{"items":{"type":"string"},"title":"Invited Emails","type":"array"}},"required":["disabled_user_emails","accepted_invite_emails","pending_invite_emails","invited_emails"],"title":"InvitationResult","type":"object"}, 'invitations_post output') },
}

export const api = {
  "account_get": operationAccountGet,
  "site_get": operationSiteGet,
  "site_patch": {
    "complete_onboarding": operationSitePatchCompleteOnboarding,
    "update_site_settings": operationSitePatchUpdateSiteSettings
  },
  "users_get": operationUsersGet,
  "invitations_get": operationInvitationsGet,
  "invitations_post": operationInvitationsPost
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
