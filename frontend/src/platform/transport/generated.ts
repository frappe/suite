// Generated from src/platform/transport/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

export type GetPreferencesInput = Record<string, never>

export type GetPreferencesOutput = {
  name: string
  email: string
  first_name: string | null
  last_name: string | null
  user_image: string | null
  language: string | null
  time_zone: string | null
  desk_theme: string | null
}

export type GetPreferencesError = never

const operationGetPreferences: QueryRef<
  GetPreferencesInput,
  GetPreferencesOutput,
  GetPreferencesError
> = {
  id: 'get_preferences',
  owner: 'suite',
  kind: 'query',
  publicName: 'preferences.get',
  method: 'GET',
  path: 'preferences',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGetPreferences,
}

export type UpdatePreferencesInput = {
  first_name?: string
  last_name?: string
  user_image?: string | null
  language?: string
  time_zone?: string
}

export type UpdatePreferencesOutput = {
  name: string
  email: string
  first_name: string | null
  last_name: string | null
  user_image: string | null
  language: string | null
  time_zone: string | null
  desk_theme: string | null
}

export type UpdatePreferencesError = never

const operationUpdatePreferences: MutationRef<
  UpdatePreferencesInput,
  UpdatePreferencesOutput,
  UpdatePreferencesError
> = {
  id: 'update_preferences',
  owner: 'suite',
  kind: 'mutation',
  publicName: 'preferences.update',
  method: 'PATCH',
  path: 'preferences',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationUpdatePreferences,
}

export type LanguagesOutputLanguage = { name: string; language_name: string }

export type LanguagesInput = Record<string, never>

export type LanguagesOutput = Array<LanguagesOutputLanguage>

export type LanguagesError = never

const operationLanguages: QueryRef<LanguagesInput, LanguagesOutput, LanguagesError> = {
  id: 'languages',
  owner: 'suite',
  kind: 'query',
  publicName: 'locales.languages',
  method: 'GET',
  path: 'languages',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationLanguages,
}

export type AccountGetOutputAccount = {
  name: string
  email: string
  full_name: string
  avatar: string | null
  roles: AccountGetOutputAccountRoles
  is_jmap_configured: boolean
}

export type AccountGetOutputAccountRoles = { system_manager: boolean }

export type AccountGetInput = Record<string, never>

export type AccountGetOutput = AccountGetOutputAccount | null

export type AccountGetError = never

const operationAccountGet: QueryRef<AccountGetInput, AccountGetOutput, AccountGetError> = {
  id: 'account_get',
  owner: 'suite',
  kind: 'query',
  publicName: 'account.get',
  method: 'GET',
  path: 'account',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationAccountGet,
}

export type SiteGetInput = Record<string, never>

export type SiteGetOutput = {
  is_onboarded: boolean
  can_onboard: boolean
  workspace_name: string
  workspace_logo: string
}

export type SiteGetError = never

const operationSiteGet: QueryRef<SiteGetInput, SiteGetOutput, SiteGetError> = {
  id: 'site_get',
  owner: 'suite',
  kind: 'query',
  publicName: 'site.get',
  method: 'GET',
  path: 'site',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationSiteGet,
}

export type SitePatchCompleteOnboardingInput = { is_onboarded: true; timezone?: string }

export type SitePatchCompleteOnboardingOutput = {
  is_onboarded: boolean
  can_onboard: boolean
  workspace_name: string
  workspace_logo: string
}

export type SitePatchCompleteOnboardingError = 'BadRequest' | 'PermissionError'

const operationSitePatchCompleteOnboarding: MutationRef<
  SitePatchCompleteOnboardingInput,
  SitePatchCompleteOnboardingOutput,
  SitePatchCompleteOnboardingError
> = {
  id: 'site_patch.complete_onboarding',
  owner: 'suite',
  kind: 'mutation',
  publicName: 'site.completeOnboarding',
  method: 'PATCH',
  path: 'site',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['BadRequest', 'PermissionError'],
  loadValidators: async () => (await import('./validators')).operationSitePatchCompleteOnboarding,
}

export type SitePatchUpdateSiteSettingsInput = { workspace_name: string; workspace_logo?: string }

export type SitePatchUpdateSiteSettingsOutput = {
  is_onboarded: boolean
  can_onboard: boolean
  workspace_name: string
  workspace_logo: string
}

export type SitePatchUpdateSiteSettingsError = 'BadRequest' | 'PermissionError'

const operationSitePatchUpdateSiteSettings: MutationRef<
  SitePatchUpdateSiteSettingsInput,
  SitePatchUpdateSiteSettingsOutput,
  SitePatchUpdateSiteSettingsError
> = {
  id: 'site_patch.update_site_settings',
  owner: 'suite',
  kind: 'mutation',
  publicName: 'site.updateSettings',
  method: 'PATCH',
  path: 'site',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['BadRequest', 'PermissionError'],
  loadValidators: async () => (await import('./validators')).operationSitePatchUpdateSiteSettings,
}

export type UsersGetOutputUser = {
  name: string
  email: string
  full_name: string
  user_image: string | null
  is_admin: boolean
}

export type UsersGetInput = Record<string, never>

export type UsersGetOutput = Array<UsersGetOutputUser>

export type UsersGetError = 'PermissionError'

const operationUsersGet: QueryRef<UsersGetInput, UsersGetOutput, UsersGetError> = {
  id: 'users_get',
  owner: 'suite',
  kind: 'query',
  publicName: 'users.list',
  method: 'GET',
  path: 'users',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError'],
  loadValidators: async () => (await import('./validators')).operationUsersGet,
}

export type InvitationsGetOutputInvitation = {
  name: string
  email: string
  creation: string
  invited_by: string
  invited_by_name: string | null
}

export type InvitationsGetInput = Record<string, never>

export type InvitationsGetOutput = Array<InvitationsGetOutputInvitation>

export type InvitationsGetError = 'PermissionError'

const operationInvitationsGet: QueryRef<
  InvitationsGetInput,
  InvitationsGetOutput,
  InvitationsGetError
> = {
  id: 'invitations_get',
  owner: 'suite',
  kind: 'query',
  publicName: 'invitations.list',
  method: 'GET',
  path: 'invitations',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError'],
  loadValidators: async () => (await import('./validators')).operationInvitationsGet,
}

export type InvitationsPostInput = { emails: string }

export type InvitationsPostOutput = {
  disabled_user_emails: Array<string>
  accepted_invite_emails: Array<string>
  pending_invite_emails: Array<string>
  invited_emails: Array<string>
}

export type InvitationsPostError = 'BadRequest' | 'PermissionError'

const operationInvitationsPost: MutationRef<
  InvitationsPostInput,
  InvitationsPostOutput,
  InvitationsPostError
> = {
  id: 'invitations_post',
  owner: 'suite',
  kind: 'mutation',
  publicName: 'invitations.create',
  method: 'POST',
  path: 'invitations',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['BadRequest', 'PermissionError'],
  loadValidators: async () => (await import('./validators')).operationInvitationsPost,
}

export type PeopleGetOutputPersonGroup = { kind: 'group'; name: string; member_count: number }

export type PeopleGetOutputPersonUser = {
  kind: 'user'
  name: string
  email: string
  full_name: string | null
  user_image: string | null
}

export type PeopleGetInput = { q?: string; cursor?: string }

export type PeopleGetOutput = {
  rows: Array<PeopleGetOutputPersonUser | PeopleGetOutputPersonGroup>
  next_cursor: string | null
}

export type PeopleGetError = 'BadRequest' | 'BadCursor' | 'PermissionError'

const operationPeopleGet: PageRef<
  PeopleGetInput,
  PeopleGetOutputPersonUser | PeopleGetOutputPersonGroup,
  PeopleGetError,
  PeopleGetOutput
> = {
  id: 'people_get',
  owner: 'suite',
  kind: 'query',
  publicName: 'people.list',
  page: { cursor: 'cursor', rows: 'rows', next: 'next_cursor' },
  method: 'GET',
  path: 'people',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['BadRequest', 'BadCursor', 'PermissionError'],
  loadValidators: async () => (await import('./validators')).operationPeopleGet,
}

export type FrappeLoginInput = { usr: string; pwd: string }

export type FrappeLoginOutput = unknown

export type FrappeLoginError = never

const operationFrappeLogin: MutationRef<FrappeLoginInput, FrappeLoginOutput, FrappeLoginError> = {
  id: 'frappe.login',
  owner: 'suite',
  kind: 'mutation',
  publicName: 'auth.login',
  method: 'POST',
  path: '/api/v2/method/login',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationFrappeLogin,
}

export type FrappeLogoutInput = Record<string, never>

export type FrappeLogoutOutput = unknown

export type FrappeLogoutError = never

const operationFrappeLogout: MutationRef<FrappeLogoutInput, FrappeLogoutOutput, FrappeLogoutError> =
  {
    id: 'frappe.logout',
    owner: 'suite',
    kind: 'mutation',
    publicName: 'auth.logout',
    method: 'POST',
    path: '/api/v2/method/logout',
    prefix: '/api/suite/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: [],
    loadValidators: async () => (await import('./validators')).operationFrappeLogout,
  }

export type FrappeTranslateGetBootTranslationsInput = Record<string, never>

export type FrappeTranslateGetBootTranslationsOutput = { [key: string]: string }

export type FrappeTranslateGetBootTranslationsError = never

const operationFrappeTranslateGetBootTranslations: QueryRef<
  FrappeTranslateGetBootTranslationsInput,
  FrappeTranslateGetBootTranslationsOutput,
  FrappeTranslateGetBootTranslationsError
> = {
  id: 'frappe.translate.get_boot_translations',
  owner: 'suite',
  kind: 'query',
  publicName: 'translations.get',
  method: 'GET',
  path: '/api/v2/method/frappe.translate.get_boot_translations',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () =>
    (await import('./validators')).operationFrappeTranslateGetBootTranslations,
}

export type SubscribeInput = { fcm_token: string; project_name: string }

export type SubscribeOutput = { success: boolean; message: string }

export type SubscribeError = never

const operationSubscribe: MutationRef<SubscribeInput, SubscribeOutput, SubscribeError> = {
  id: 'subscribe',
  owner: 'suite',
  kind: 'mutation',
  publicName: 'push.subscribe',
  envelope: 'message',
  method: 'GET',
  path: '/api/method/frappe.push_notification.subscribe',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationSubscribe,
}

export type UnsubscribeInput = { fcm_token: string; project_name: string }

export type UnsubscribeOutput = { success: boolean; message: string }

export type UnsubscribeError = never

const operationUnsubscribe: MutationRef<UnsubscribeInput, UnsubscribeOutput, UnsubscribeError> = {
  id: 'unsubscribe',
  owner: 'suite',
  kind: 'mutation',
  publicName: 'push.unsubscribe',
  envelope: 'message',
  method: 'GET',
  path: '/api/method/frappe.push_notification.unsubscribe',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationUnsubscribe,
}

export type FrappeUserSwitchThemeInput = { theme: 'Light' | 'Dark' | 'Automatic' }

export type FrappeUserSwitchThemeOutput = null

export type FrappeUserSwitchThemeError = never

const operationFrappeUserSwitchTheme: MutationRef<
  FrappeUserSwitchThemeInput,
  FrappeUserSwitchThemeOutput,
  FrappeUserSwitchThemeError
> = {
  id: 'frappe.user.switch_theme',
  owner: 'suite',
  kind: 'mutation',
  publicName: 'preferences.setTheme',
  empty: true,
  method: 'POST',
  path: '/api/v2/method/frappe.core.doctype.user.user.switch_theme',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationFrappeUserSwitchTheme,
}

export type FrappeUserResetPasswordInput = { key: string; new_password: string }

export type FrappeUserResetPasswordOutput = string

export type FrappeUserResetPasswordError = 'AuthenticationError' | 'ValidationError'

const operationFrappeUserResetPassword: MutationRef<
  FrappeUserResetPasswordInput,
  FrappeUserResetPasswordOutput,
  FrappeUserResetPasswordError
> = {
  id: 'frappe.user.reset_password',
  owner: 'suite',
  kind: 'mutation',
  publicName: 'account.resetPassword',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/frappe.core.doctype.user.user.update_password',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationFrappeUserResetPassword,
}

export type FrappeUserGetTimezonesInput = Record<string, never>

export type FrappeUserGetTimezonesOutput = { timezones: Array<string> }

export type FrappeUserGetTimezonesError = never

const operationFrappeUserGetTimezones: QueryRef<
  FrappeUserGetTimezonesInput,
  FrappeUserGetTimezonesOutput,
  FrappeUserGetTimezonesError
> = {
  id: 'frappe.user.get_timezones',
  owner: 'suite',
  kind: 'query',
  publicName: 'locales.timezones',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/frappe.core.doctype.user.user.get_timezones',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationFrappeUserGetTimezones,
}

export type FrappeUserUpdatePasswordInput = { old_password: string; new_password: string }

export type FrappeUserUpdatePasswordOutput = string

export type FrappeUserUpdatePasswordError = 'AuthenticationError' | 'ValidationError'

const operationFrappeUserUpdatePassword: MutationRef<
  FrappeUserUpdatePasswordInput,
  FrappeUserUpdatePasswordOutput,
  FrappeUserUpdatePasswordError
> = {
  id: 'frappe.user.update_password',
  owner: 'suite',
  kind: 'mutation',
  publicName: 'account.changePassword',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/frappe.core.doctype.user.user.update_password',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationFrappeUserUpdatePassword,
}

export type SuiteGenerateUserKeysInput = { user: string }

export type SuiteGenerateUserKeysOutput = { api_key: string; api_secret: string }

export type SuiteGenerateUserKeysError = 'PermissionError'

const operationSuiteGenerateUserKeys: MutationRef<
  SuiteGenerateUserKeysInput,
  SuiteGenerateUserKeysOutput,
  SuiteGenerateUserKeysError
> = {
  id: 'suite.generate_user_keys',
  owner: 'suite',
  kind: 'mutation',
  publicName: 'account.generateKeys',
  method: 'POST',
  path: '/api/v2/method/suite.utils.user.generate_user_keys',
  prefix: '/api/suite/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError'],
  loadValidators: async () => (await import('./validators')).operationSuiteGenerateUserKeys,
}

export const api = {
  preferences: {
    get: operationGetPreferences,
    update: operationUpdatePreferences,
    setTheme: operationFrappeUserSwitchTheme,
  },
  locales: {
    languages: operationLanguages,
    timezones: operationFrappeUserGetTimezones,
  },
  account: {
    get: operationAccountGet,
    resetPassword: operationFrappeUserResetPassword,
    changePassword: operationFrappeUserUpdatePassword,
    generateKeys: operationSuiteGenerateUserKeys,
  },
  site: {
    get: operationSiteGet,
    completeOnboarding: operationSitePatchCompleteOnboarding,
    updateSettings: operationSitePatchUpdateSiteSettings,
  },
  users: {
    list: operationUsersGet,
  },
  invitations: {
    list: operationInvitationsGet,
    create: operationInvitationsPost,
  },
  people: {
    list: operationPeopleGet,
  },
  auth: {
    login: operationFrappeLogin,
    logout: operationFrappeLogout,
  },
  translations: {
    get: operationFrappeTranslateGetBootTranslations,
  },
  push: {
    subscribe: operationSubscribe,
    unsubscribe: operationUnsubscribe,
  },
} as const
