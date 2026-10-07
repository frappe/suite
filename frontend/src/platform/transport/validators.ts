// Generated from src/platform/transport/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  AccountGetInput,
  AccountGetOutput,
  FrappeLoginInput,
  FrappeLoginOutput,
  FrappeLogoutInput,
  FrappeLogoutOutput,
  FrappeTranslateGetBootTranslationsInput,
  FrappeTranslateGetBootTranslationsOutput,
  FrappeUserGetTimezonesInput,
  FrappeUserGetTimezonesOutput,
  FrappeUserResetPasswordInput,
  FrappeUserResetPasswordOutput,
  FrappeUserSwitchThemeInput,
  FrappeUserSwitchThemeOutput,
  FrappeUserUpdatePasswordInput,
  FrappeUserUpdatePasswordOutput,
  GetPreferencesInput,
  GetPreferencesOutput,
  InvitationsGetInput,
  InvitationsGetOutput,
  InvitationsPostInput,
  InvitationsPostOutput,
  LanguagesInput,
  LanguagesOutput,
  PeopleGetInput,
  PeopleGetOutput,
  SiteGetInput,
  SiteGetOutput,
  SitePatchCompleteOnboardingInput,
  SitePatchCompleteOnboardingOutput,
  SitePatchUpdateSiteSettingsInput,
  SitePatchUpdateSiteSettingsOutput,
  SubscribeInput,
  SubscribeOutput,
  SuiteGenerateUserKeysInput,
  SuiteGenerateUserKeysOutput,
  UnsubscribeInput,
  UnsubscribeOutput,
  UpdatePreferencesInput,
  UpdatePreferencesOutput,
  UsersGetInput,
  UsersGetOutput,
} from './generated'

export const operationGetPreferences: Validators<GetPreferencesInput, GetPreferencesOutput> = {
  validateInput(value: unknown): asserts value is GetPreferencesInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_preferences input',
    )
  },
  validateOutput(value: unknown): asserts value is GetPreferencesOutput {
    assertSchema(
      value,
      {
        properties: {
          name: { title: 'Name', type: 'string' },
          email: { title: 'Email', type: 'string' },
          first_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'First Name' },
          last_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Last Name' },
          user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
          language: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Language' },
          time_zone: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Time Zone' },
          desk_theme: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Desk Theme' },
        },
        required: [
          'name',
          'email',
          'first_name',
          'last_name',
          'user_image',
          'language',
          'time_zone',
          'desk_theme',
        ],
        title: 'Preferences',
        type: 'object',
      },
      'get_preferences output',
    )
  },
}

export const operationUpdatePreferences: Validators<
  UpdatePreferencesInput,
  UpdatePreferencesOutput
> = {
  validateInput(value: unknown): asserts value is UpdatePreferencesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          first_name: { title: 'First Name', type: 'string' },
          last_name: { title: 'Last Name', type: 'string' },
          user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
          language: { title: 'Language', type: 'string' },
          time_zone: { title: 'Time Zone', type: 'string' },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'update_preferences input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdatePreferencesOutput {
    assertSchema(
      value,
      {
        properties: {
          name: { title: 'Name', type: 'string' },
          email: { title: 'Email', type: 'string' },
          first_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'First Name' },
          last_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Last Name' },
          user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
          language: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Language' },
          time_zone: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Time Zone' },
          desk_theme: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Desk Theme' },
        },
        required: [
          'name',
          'email',
          'first_name',
          'last_name',
          'user_image',
          'language',
          'time_zone',
          'desk_theme',
        ],
        title: 'Preferences',
        type: 'object',
      },
      'update_preferences output',
    )
  },
}

export const operationLanguages: Validators<LanguagesInput, LanguagesOutput> = {
  validateInput(value: unknown): asserts value is LanguagesInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'languages input',
    )
  },
  validateOutput(value: unknown): asserts value is LanguagesOutput {
    assertSchema(
      value,
      {
        $defs: {
          Language: {
            properties: {
              name: { title: 'Name', type: 'string' },
              language_name: { title: 'Language Name', type: 'string' },
            },
            required: ['name', 'language_name'],
            title: 'Language',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/Language' },
        type: 'array',
      },
      'languages output',
    )
  },
}

export const operationAccountGet: Validators<AccountGetInput, AccountGetOutput> = {
  validateInput(value: unknown): asserts value is AccountGetInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'account_get input',
    )
  },
  validateOutput(value: unknown): asserts value is AccountGetOutput {
    assertSchema(
      value,
      {
        $defs: {
          Account: {
            properties: {
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
              full_name: { title: 'Full Name', type: 'string' },
              avatar: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Avatar' },
              roles: { $ref: '#/$defs/AccountRoles' },
              is_jmap_configured: { title: 'Is Jmap Configured', type: 'boolean' },
            },
            required: ['name', 'email', 'full_name', 'avatar', 'roles', 'is_jmap_configured'],
            title: 'Account',
            type: 'object',
          },
          AccountRoles: {
            properties: { system_manager: { title: 'System Manager', type: 'boolean' } },
            required: ['system_manager'],
            title: 'AccountRoles',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/Account' }, { type: 'null' }],
      },
      'account_get output',
    )
  },
}

export const operationSiteGet: Validators<SiteGetInput, SiteGetOutput> = {
  validateInput(value: unknown): asserts value is SiteGetInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'site_get input',
    )
  },
  validateOutput(value: unknown): asserts value is SiteGetOutput {
    assertSchema(
      value,
      {
        properties: {
          is_onboarded: { title: 'Is Onboarded', type: 'boolean' },
          can_onboard: { title: 'Can Onboard', type: 'boolean' },
          workspace_name: { title: 'Workspace Name', type: 'string' },
          workspace_logo: { title: 'Workspace Logo', type: 'string' },
        },
        required: ['is_onboarded', 'can_onboard', 'workspace_name', 'workspace_logo'],
        title: 'Site',
        type: 'object',
      },
      'site_get output',
    )
  },
}

export const operationSitePatchCompleteOnboarding: Validators<
  SitePatchCompleteOnboardingInput,
  SitePatchCompleteOnboardingOutput
> = {
  validateInput(value: unknown): asserts value is SitePatchCompleteOnboardingInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          is_onboarded: { const: true, title: 'Is Onboarded', type: 'boolean' },
          timezone: { title: 'Timezone', type: 'string' },
        },
        required: ['is_onboarded'],
        additionalProperties: false,
        $defs: {},
      },
      'site_patch.complete_onboarding input',
    )
  },
  validateOutput(value: unknown): asserts value is SitePatchCompleteOnboardingOutput {
    assertSchema(
      value,
      {
        properties: {
          is_onboarded: { title: 'Is Onboarded', type: 'boolean' },
          can_onboard: { title: 'Can Onboard', type: 'boolean' },
          workspace_name: { title: 'Workspace Name', type: 'string' },
          workspace_logo: { title: 'Workspace Logo', type: 'string' },
        },
        required: ['is_onboarded', 'can_onboard', 'workspace_name', 'workspace_logo'],
        title: 'Site',
        type: 'object',
      },
      'site_patch.complete_onboarding output',
    )
  },
}

export const operationSitePatchUpdateSiteSettings: Validators<
  SitePatchUpdateSiteSettingsInput,
  SitePatchUpdateSiteSettingsOutput
> = {
  validateInput(value: unknown): asserts value is SitePatchUpdateSiteSettingsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          workspace_name: { title: 'Workspace Name', type: 'string' },
          workspace_logo: { title: 'Workspace Logo', type: 'string' },
        },
        required: ['workspace_name'],
        additionalProperties: false,
        $defs: {},
      },
      'site_patch.update_site_settings input',
    )
  },
  validateOutput(value: unknown): asserts value is SitePatchUpdateSiteSettingsOutput {
    assertSchema(
      value,
      {
        properties: {
          is_onboarded: { title: 'Is Onboarded', type: 'boolean' },
          can_onboard: { title: 'Can Onboard', type: 'boolean' },
          workspace_name: { title: 'Workspace Name', type: 'string' },
          workspace_logo: { title: 'Workspace Logo', type: 'string' },
        },
        required: ['is_onboarded', 'can_onboard', 'workspace_name', 'workspace_logo'],
        title: 'Site',
        type: 'object',
      },
      'site_patch.update_site_settings output',
    )
  },
}

export const operationUsersGet: Validators<UsersGetInput, UsersGetOutput> = {
  validateInput(value: unknown): asserts value is UsersGetInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'users_get input',
    )
  },
  validateOutput(value: unknown): asserts value is UsersGetOutput {
    assertSchema(
      value,
      {
        $defs: {
          User: {
            properties: {
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
              full_name: { title: 'Full Name', type: 'string' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
              is_admin: { title: 'Is Admin', type: 'boolean' },
            },
            required: ['name', 'email', 'full_name', 'user_image', 'is_admin'],
            title: 'User',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/User' },
        type: 'array',
      },
      'users_get output',
    )
  },
}

export const operationInvitationsGet: Validators<InvitationsGetInput, InvitationsGetOutput> = {
  validateInput(value: unknown): asserts value is InvitationsGetInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'invitations_get input',
    )
  },
  validateOutput(value: unknown): asserts value is InvitationsGetOutput {
    assertSchema(
      value,
      {
        $defs: {
          Invitation: {
            properties: {
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
              creation: { title: 'Creation', type: 'string' },
              invited_by: { title: 'Invited By', type: 'string' },
              invited_by_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Invited By Name',
              },
            },
            required: ['name', 'email', 'creation', 'invited_by', 'invited_by_name'],
            title: 'Invitation',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/Invitation' },
        type: 'array',
      },
      'invitations_get output',
    )
  },
}

export const operationInvitationsPost: Validators<InvitationsPostInput, InvitationsPostOutput> = {
  validateInput(value: unknown): asserts value is InvitationsPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { emails: { title: 'Emails', type: 'string' } },
        required: ['emails'],
        additionalProperties: false,
        $defs: {},
      },
      'invitations_post input',
    )
  },
  validateOutput(value: unknown): asserts value is InvitationsPostOutput {
    assertSchema(
      value,
      {
        properties: {
          disabled_user_emails: {
            items: { type: 'string' },
            title: 'Disabled User Emails',
            type: 'array',
          },
          accepted_invite_emails: {
            items: { type: 'string' },
            title: 'Accepted Invite Emails',
            type: 'array',
          },
          pending_invite_emails: {
            items: { type: 'string' },
            title: 'Pending Invite Emails',
            type: 'array',
          },
          invited_emails: { items: { type: 'string' }, title: 'Invited Emails', type: 'array' },
        },
        required: [
          'disabled_user_emails',
          'accepted_invite_emails',
          'pending_invite_emails',
          'invited_emails',
        ],
        title: 'InvitationResult',
        type: 'object',
      },
      'invitations_post output',
    )
  },
}

export const operationPeopleGet: Validators<PeopleGetInput, PeopleGetOutput> = {
  validateInput(value: unknown): asserts value is PeopleGetInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          q: { title: 'Q', type: 'string' },
          cursor: { title: 'Cursor', type: 'string' },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'people_get input',
    )
  },
  validateOutput(value: unknown): asserts value is PeopleGetOutput {
    assertSchema(
      value,
      {
        $defs: {
          PersonGroup: {
            properties: {
              kind: { const: 'group', title: 'Kind', type: 'string' },
              name: { title: 'Name', type: 'string' },
              member_count: { title: 'Member Count', type: 'integer' },
            },
            required: ['kind', 'name', 'member_count'],
            title: 'PersonGroup',
            type: 'object',
          },
          PersonUser: {
            properties: {
              kind: { const: 'user', title: 'Kind', type: 'string' },
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
              full_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Full Name' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: ['kind', 'name', 'email', 'full_name', 'user_image'],
            title: 'PersonUser',
            type: 'object',
          },
        },
        properties: {
          rows: {
            items: { anyOf: [{ $ref: '#/$defs/PersonUser' }, { $ref: '#/$defs/PersonGroup' }] },
            title: 'Rows',
            type: 'array',
          },
          next_cursor: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Next Cursor' },
        },
        required: ['rows', 'next_cursor'],
        title: 'PeoplePage',
        type: 'object',
      },
      'people_get output',
    )
  },
}

export const operationFrappeLogin: Validators<FrappeLoginInput, FrappeLoginOutput> = {
  validateInput(value: unknown): asserts value is FrappeLoginInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          usr: { title: 'Usr', type: 'string' },
          pwd: { title: 'Pwd', type: 'string' },
        },
        required: ['usr', 'pwd'],
        additionalProperties: false,
        $defs: {},
      },
      'frappe.login input',
    )
  },
  validateOutput(value: unknown): asserts value is FrappeLoginOutput {
    assertSchema(value, {}, 'frappe.login output')
  },
}

export const operationFrappeLogout: Validators<FrappeLogoutInput, FrappeLogoutOutput> = {
  validateInput(value: unknown): asserts value is FrappeLogoutInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'frappe.logout input',
    )
  },
  validateOutput(value: unknown): asserts value is FrappeLogoutOutput {
    assertSchema(value, {}, 'frappe.logout output')
  },
}

export const operationFrappeTranslateGetBootTranslations: Validators<
  FrappeTranslateGetBootTranslationsInput,
  FrappeTranslateGetBootTranslationsOutput
> = {
  validateInput(value: unknown): asserts value is FrappeTranslateGetBootTranslationsInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'frappe.translate.get_boot_translations input',
    )
  },
  validateOutput(value: unknown): asserts value is FrappeTranslateGetBootTranslationsOutput {
    assertSchema(
      value,
      { additionalProperties: { type: 'string' }, type: 'object' },
      'frappe.translate.get_boot_translations output',
    )
  },
}

export const operationSubscribe: Validators<SubscribeInput, SubscribeOutput> = {
  validateInput(value: unknown): asserts value is SubscribeInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          fcm_token: { title: 'Fcm Token', type: 'string' },
          project_name: { title: 'Project Name', type: 'string' },
        },
        required: ['fcm_token', 'project_name'],
        additionalProperties: false,
        $defs: {},
      },
      'subscribe input',
    )
  },
  validateOutput(value: unknown): asserts value is SubscribeOutput {
    assertSchema(
      value,
      {
        properties: {
          success: { title: 'Success', type: 'boolean' },
          message: { title: 'Message', type: 'string' },
        },
        required: ['success', 'message'],
        title: 'PushResult',
        type: 'object',
      },
      'subscribe output',
    )
  },
}

export const operationUnsubscribe: Validators<UnsubscribeInput, UnsubscribeOutput> = {
  validateInput(value: unknown): asserts value is UnsubscribeInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          fcm_token: { title: 'Fcm Token', type: 'string' },
          project_name: { title: 'Project Name', type: 'string' },
        },
        required: ['fcm_token', 'project_name'],
        additionalProperties: false,
        $defs: {},
      },
      'unsubscribe input',
    )
  },
  validateOutput(value: unknown): asserts value is UnsubscribeOutput {
    assertSchema(
      value,
      {
        properties: {
          success: { title: 'Success', type: 'boolean' },
          message: { title: 'Message', type: 'string' },
        },
        required: ['success', 'message'],
        title: 'PushResult',
        type: 'object',
      },
      'unsubscribe output',
    )
  },
}

export const operationFrappeUserSwitchTheme: Validators<
  FrappeUserSwitchThemeInput,
  FrappeUserSwitchThemeOutput
> = {
  validateInput(value: unknown): asserts value is FrappeUserSwitchThemeInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          theme: { enum: ['Light', 'Dark', 'Automatic'], title: 'Theme', type: 'string' },
        },
        required: ['theme'],
        additionalProperties: false,
        $defs: {},
      },
      'frappe.user.switch_theme input',
    )
  },
  validateOutput(value: unknown): asserts value is FrappeUserSwitchThemeOutput {
    assertSchema(value, { type: 'null' }, 'frappe.user.switch_theme output')
  },
}

export const operationFrappeUserResetPassword: Validators<
  FrappeUserResetPasswordInput,
  FrappeUserResetPasswordOutput
> = {
  validateInput(value: unknown): asserts value is FrappeUserResetPasswordInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          key: { title: 'Key', type: 'string' },
          new_password: { title: 'New Password', type: 'string' },
        },
        required: ['key', 'new_password'],
        additionalProperties: false,
        $defs: {},
      },
      'frappe.user.reset_password input',
    )
  },
  validateOutput(value: unknown): asserts value is FrappeUserResetPasswordOutput {
    assertSchema(value, { type: 'string' }, 'frappe.user.reset_password output')
  },
}

export const operationFrappeUserGetTimezones: Validators<
  FrappeUserGetTimezonesInput,
  FrappeUserGetTimezonesOutput
> = {
  validateInput(value: unknown): asserts value is FrappeUserGetTimezonesInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'frappe.user.get_timezones input',
    )
  },
  validateOutput(value: unknown): asserts value is FrappeUserGetTimezonesOutput {
    assertSchema(
      value,
      {
        properties: { timezones: { items: { type: 'string' }, title: 'Timezones', type: 'array' } },
        required: ['timezones'],
        title: 'Timezones',
        type: 'object',
      },
      'frappe.user.get_timezones output',
    )
  },
}

export const operationFrappeUserUpdatePassword: Validators<
  FrappeUserUpdatePasswordInput,
  FrappeUserUpdatePasswordOutput
> = {
  validateInput(value: unknown): asserts value is FrappeUserUpdatePasswordInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          old_password: { title: 'Old Password', type: 'string' },
          new_password: { title: 'New Password', type: 'string' },
        },
        required: ['old_password', 'new_password'],
        additionalProperties: false,
        $defs: {},
      },
      'frappe.user.update_password input',
    )
  },
  validateOutput(value: unknown): asserts value is FrappeUserUpdatePasswordOutput {
    assertSchema(value, { type: 'string' }, 'frappe.user.update_password output')
  },
}

export const operationSuiteGenerateUserKeys: Validators<
  SuiteGenerateUserKeysInput,
  SuiteGenerateUserKeysOutput
> = {
  validateInput(value: unknown): asserts value is SuiteGenerateUserKeysInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { user: { title: 'User', type: 'string' } },
        required: ['user'],
        additionalProperties: false,
        $defs: {},
      },
      'suite.generate_user_keys input',
    )
  },
  validateOutput(value: unknown): asserts value is SuiteGenerateUserKeysOutput {
    assertSchema(
      value,
      {
        properties: {
          api_key: { title: 'Api Key', type: 'string' },
          api_secret: { title: 'Api Secret', type: 'string' },
        },
        required: ['api_key', 'api_secret'],
        title: 'UserKeys',
        type: 'object',
      },
      'suite.generate_user_keys output',
    )
  },
}
