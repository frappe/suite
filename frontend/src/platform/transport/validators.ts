// Generated from src/platform/transport/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  AccountGetInput,
  AccountGetOutput,
  AdminHealthGetInput,
  AdminHealthGetOutput,
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
  MailAccountDeleteInput,
  MailAccountDeleteOutput,
  MailAccountPostInput,
  MailAccountPostOutput,
  OnboardingGetInput,
  OnboardingGetOutput,
  OnboardingPostInput,
  OnboardingPostOutput,
  PeopleGetInput,
  PeopleGetOutput,
  SiteGetInput,
  SiteGetOutput,
  SitePatchCompleteOnboardingInput,
  SitePatchCompleteOnboardingOutput,
  SitePatchUpdateSiteSettingsInput,
  SitePatchUpdateSiteSettingsOutput,
  StorageBuffersInput,
  StorageBuffersOutput,
  StorageDefaultInput,
  StorageDefaultOutput,
  StorageGetInput,
  StorageGetOutput,
  StorageLimitsInput,
  StorageLimitsOutput,
  StorageRefreshInput,
  StorageRefreshOutput,
  SubscribeInput,
  SubscribeOutput,
  SuiteGenerateUserKeysInput,
  SuiteGenerateUserKeysOutput,
  TemporaryPasswordPostInput,
  TemporaryPasswordPostOutput,
  UnsubscribeInput,
  UnsubscribeOutput,
  UpdatePreferencesInput,
  UpdatePreferencesOutput,
  UsersGetInput,
  UsersGetOutput,
  UsersPatchInput,
  UsersPatchOutput,
  UserTransferInput,
  UserTransferOutput,
  UserTransferPreviewInput,
  UserTransferPreviewOutput,
} from './generated'

export const operationAdminHealthGet: Validators<AdminHealthGetInput, AdminHealthGetOutput> = {
  validateInput(value: unknown): asserts value is AdminHealthGetInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'admin_health_get input',
    )
  },
  validateOutput(value: unknown): asserts value is AdminHealthGetOutput {
    assertSchema(
      value,
      {
        properties: {
          cloud: { title: 'Cloud', type: 'boolean' },
          suspended: { title: 'Suspended', type: 'boolean' },
          stale: { title: 'Stale', type: 'boolean' },
          fetched_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Fetched At' },
          alerts: { items: { type: 'string' }, title: 'Alerts', type: 'array' },
        },
        required: ['cloud', 'suspended', 'stale', 'fetched_at', 'alerts'],
        title: 'ProviderHealth',
        type: 'object',
      },
      'admin_health_get output',
    )
  },
}

export const operationTemporaryPasswordPost: Validators<
  TemporaryPasswordPostInput,
  TemporaryPasswordPostOutput
> = {
  validateInput(value: unknown): asserts value is TemporaryPasswordPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { user: { title: 'User', type: 'string' } },
        required: ['user'],
        additionalProperties: false,
        $defs: {},
      },
      'temporary_password_post input',
    )
  },
  validateOutput(value: unknown): asserts value is TemporaryPasswordPostOutput {
    assertSchema(
      value,
      {
        properties: {
          user: { title: 'User', type: 'string' },
          temporary_password: { title: 'Temporary Password', type: 'string' },
          expires_at: { title: 'Expires At', type: 'string' },
        },
        required: ['user', 'temporary_password', 'expires_at'],
        title: 'TemporaryCredential',
        type: 'object',
      },
      'temporary_password_post output',
    )
  },
}

export const operationMailAccountPost: Validators<MailAccountPostInput, MailAccountPostOutput> = {
  validateInput(value: unknown): asserts value is MailAccountPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          user: { title: 'User', type: 'string' },
          address: { title: 'Address', type: 'string' },
        },
        required: ['user', 'address'],
        additionalProperties: false,
        $defs: {},
      },
      'mail_account_post input',
    )
  },
  validateOutput(value: unknown): asserts value is MailAccountPostOutput {
    assertSchema(
      value,
      {
        properties: {
          success: { title: 'Success', type: 'boolean' },
          user: { title: 'User', type: 'string' },
          status: { title: 'Status', type: 'string' },
          error: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Error' },
          temporary_password: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Temporary Password',
          },
          expires_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires At' },
        },
        required: ['success', 'user', 'status', 'error', 'temporary_password', 'expires_at'],
        title: 'CreationResult',
        type: 'object',
      },
      'mail_account_post output',
    )
  },
}

export const operationMailAccountDelete: Validators<
  MailAccountDeleteInput,
  MailAccountDeleteOutput
> = {
  validateInput(value: unknown): asserts value is MailAccountDeleteInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          user: { title: 'User', type: 'string' },
          confirmation: { title: 'Confirmation', type: 'string' },
        },
        required: ['user', 'confirmation'],
        additionalProperties: false,
        $defs: {},
      },
      'mail_account_delete input',
    )
  },
  validateOutput(value: unknown): asserts value is MailAccountDeleteOutput {
    assertSchema(
      value,
      {
        properties: {
          success: { title: 'Success', type: 'boolean' },
          user: { title: 'User', type: 'string' },
          status: { title: 'Status', type: 'string' },
          error: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Error' },
          temporary_password: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Temporary Password',
          },
          expires_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires At' },
        },
        required: ['success', 'user', 'status', 'error', 'temporary_password', 'expires_at'],
        title: 'CreationResult',
        type: 'object',
      },
      'mail_account_delete output',
    )
  },
}

export const operationOnboardingGet: Validators<OnboardingGetInput, OnboardingGetOutput> = {
  validateInput(value: unknown): asserts value is OnboardingGetInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'onboarding_get input',
    )
  },
  validateOutput(value: unknown): asserts value is OnboardingGetOutput {
    assertSchema(
      value,
      {
        properties: {
          cloud: { title: 'Cloud', type: 'boolean' },
          domains: { items: { type: 'string' }, title: 'Domains', type: 'array' },
          account: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Account' },
          ready: { title: 'Ready', type: 'boolean' },
        },
        required: ['cloud', 'domains', 'account', 'ready'],
        title: 'OnboardingOptions',
        type: 'object',
      },
      'onboarding_get output',
    )
  },
}

export const operationOnboardingPost: Validators<OnboardingPostInput, OnboardingPostOutput> = {
  validateInput(value: unknown): asserts value is OnboardingPostInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          address: { title: 'Address', type: 'string' },
          password: { title: 'Password', type: 'string' },
        },
        required: ['address', 'password'],
        additionalProperties: false,
        $defs: {},
      },
      'onboarding_post input',
    )
  },
  validateOutput(value: unknown): asserts value is OnboardingPostOutput {
    assertSchema(
      value,
      {
        properties: {
          success: { title: 'Success', type: 'boolean' },
          user: { title: 'User', type: 'string' },
          status: { title: 'Status', type: 'string' },
          error: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Error' },
          temporary_password: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Temporary Password',
          },
          expires_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires At' },
        },
        required: ['success', 'user', 'status', 'error', 'temporary_password', 'expires_at'],
        title: 'CreationResult',
        type: 'object',
      },
      'onboarding_post output',
    )
  },
}

export const operationUserTransferPreview: Validators<
  UserTransferPreviewInput,
  UserTransferPreviewOutput
> = {
  validateInput(value: unknown): asserts value is UserTransferPreviewInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          user: { title: 'User', type: 'string' },
          destination: { title: 'Destination', type: 'string' },
        },
        required: ['user', 'destination'],
        additionalProperties: false,
        $defs: {},
      },
      'user_transfer_preview input',
    )
  },
  validateOutput(value: unknown): asserts value is UserTransferPreviewOutput {
    assertSchema(
      value,
      {
        $defs: {
          InheritedGrant: {
            properties: {
              principal: { title: 'Principal', type: 'string' },
              role: { title: 'Role', type: 'integer' },
            },
            required: ['principal', 'role'],
            title: 'InheritedGrant',
            type: 'object',
          },
        },
        properties: {
          source_root: { title: 'Source Root', type: 'string' },
          destination: { title: 'Destination', type: 'string' },
          destination_user: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Destination User',
          },
          bytes: { title: 'Bytes', type: 'integer' },
          item_count: { title: 'Item Count', type: 'integer' },
          fingerprint: { title: 'Fingerprint', type: 'string' },
          inherited_grants: {
            items: { $ref: '#/$defs/InheritedGrant' },
            title: 'Inherited Grants',
            type: 'array',
          },
        },
        required: [
          'source_root',
          'destination',
          'destination_user',
          'bytes',
          'item_count',
          'fingerprint',
          'inherited_grants',
        ],
        title: 'TransferPreview',
        type: 'object',
      },
      'user_transfer_preview output',
    )
  },
}

export const operationUserTransfer: Validators<UserTransferInput, UserTransferOutput> = {
  validateInput(value: unknown): asserts value is UserTransferInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          user: { title: 'User', type: 'string' },
          destination: { title: 'Destination', type: 'string' },
          fingerprint: { title: 'Fingerprint', type: 'string' },
          confirm_access: { title: 'Confirm Access', type: 'boolean' },
        },
        required: ['user', 'destination', 'fingerprint', 'confirm_access'],
        additionalProperties: false,
        $defs: {},
      },
      'user_transfer input',
    )
  },
  validateOutput(value: unknown): asserts value is UserTransferOutput {
    assertSchema(
      value,
      {
        $defs: {
          TransferItem: {
            properties: {
              node: { title: 'Node', type: 'string' },
              success: { title: 'Success', type: 'boolean' },
              error: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Error' },
            },
            required: ['node', 'success', 'error'],
            title: 'TransferItem',
            type: 'object',
          },
        },
        properties: {
          results: { items: { $ref: '#/$defs/TransferItem' }, title: 'Results', type: 'array' },
          remaining: { title: 'Remaining', type: 'integer' },
          complete: { title: 'Complete', type: 'boolean' },
        },
        required: ['results', 'remaining', 'complete'],
        title: 'TransferResult',
        type: 'object',
      },
      'user_transfer output',
    )
  },
}

export const operationStorageBuffers: Validators<StorageBuffersInput, StorageBuffersOutput> = {
  validateInput(value: unknown): asserts value is StorageBuffersInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          users: { items: { type: 'string' }, title: 'Users', type: 'array' },
          grant: { title: 'Grant', type: 'boolean' },
        },
        required: ['users', 'grant'],
        additionalProperties: false,
        $defs: {},
      },
      'storage_buffers input',
    )
  },
  validateOutput(value: unknown): asserts value is StorageBuffersOutput {
    assertSchema(
      value,
      {
        $defs: {
          LimitResult: {
            properties: {
              user: { title: 'User', type: 'string' },
              success: { title: 'Success', type: 'boolean' },
              error: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Error' },
            },
            required: ['user', 'success', 'error'],
            title: 'LimitResult',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/LimitResult' },
        type: 'array',
      },
      'storage_buffers output',
    )
  },
}

export const operationStorageGet: Validators<StorageGetInput, StorageGetOutput> = {
  validateInput(value: unknown): asserts value is StorageGetInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'storage_get input',
    )
  },
  validateOutput(value: unknown): asserts value is StorageGetOutput {
    assertSchema(
      value,
      {
        $defs: {
          StorageRoot: {
            properties: {
              name: { title: 'Name', type: 'string' },
              user: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User' },
              kind: { title: 'Kind', type: 'string' },
              state: { title: 'State', type: 'string' },
              stored_bytes: { title: 'Stored Bytes', type: 'integer' },
              reserved_bytes: { title: 'Reserved Bytes', type: 'integer' },
              quota_bytes: { title: 'Quota Bytes', type: 'integer' },
              effective_quota_bytes: { title: 'Effective Quota Bytes', type: 'integer' },
            },
            required: [
              'name',
              'user',
              'kind',
              'state',
              'stored_bytes',
              'reserved_bytes',
              'quota_bytes',
              'effective_quota_bytes',
            ],
            title: 'StorageRoot',
            type: 'object',
          },
          StorageUser: {
            properties: {
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
              full_name: { title: 'Full Name', type: 'string' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
              enabled: { title: 'Enabled', type: 'boolean' },
              is_admin: { title: 'Is Admin', type: 'boolean' },
              drive_bytes: { title: 'Drive Bytes', type: 'integer' },
              reserved_bytes: { title: 'Reserved Bytes', type: 'integer' },
              mail_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Mail Bytes' },
              combined_bytes: {
                anyOf: [{ type: 'integer' }, { type: 'null' }],
                title: 'Combined Bytes',
              },
              cap_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Cap Bytes' },
              buffer: { title: 'Buffer', type: 'boolean' },
              effective_cap_bytes: {
                anyOf: [{ type: 'integer' }, { type: 'null' }],
                title: 'Effective Cap Bytes',
              },
              mail_fetched_at: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Mail Fetched At',
              },
            },
            required: [
              'name',
              'email',
              'full_name',
              'user_image',
              'enabled',
              'is_admin',
              'drive_bytes',
              'reserved_bytes',
              'mail_bytes',
              'combined_bytes',
              'cap_bytes',
              'buffer',
              'effective_cap_bytes',
              'mail_fetched_at',
            ],
            title: 'StorageUser',
            type: 'object',
          },
        },
        properties: {
          cloud: { title: 'Cloud', type: 'boolean' },
          drive_bytes: { title: 'Drive Bytes', type: 'integer' },
          personal_drive_bytes: { title: 'Personal Drive Bytes', type: 'integer' },
          shared_drive_bytes: { title: 'Shared Drive Bytes', type: 'integer' },
          group_mail_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Group Mail Bytes',
          },
          pending_invitations: { title: 'Pending Invitations', type: 'integer' },
          reserved_bytes: { title: 'Reserved Bytes', type: 'integer' },
          mail_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Mail Bytes' },
          combined_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Combined Bytes',
          },
          allowance_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Allowance Bytes',
          },
          effective_allowance_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Effective Allowance Bytes',
          },
          stale: { title: 'Stale', type: 'boolean' },
          fetched_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Fetched At' },
          default_cap_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Default Cap Bytes',
          },
          users: { items: { $ref: '#/$defs/StorageUser' }, title: 'Users', type: 'array' },
          roots: { items: { $ref: '#/$defs/StorageRoot' }, title: 'Roots', type: 'array' },
        },
        required: [
          'cloud',
          'drive_bytes',
          'personal_drive_bytes',
          'shared_drive_bytes',
          'group_mail_bytes',
          'pending_invitations',
          'reserved_bytes',
          'mail_bytes',
          'combined_bytes',
          'allowance_bytes',
          'effective_allowance_bytes',
          'stale',
          'fetched_at',
          'default_cap_bytes',
          'users',
          'roots',
        ],
        title: 'StorageReport',
        type: 'object',
      },
      'storage_get output',
    )
  },
}

export const operationStorageRefresh: Validators<StorageRefreshInput, StorageRefreshOutput> = {
  validateInput(value: unknown): asserts value is StorageRefreshInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'storage_refresh input',
    )
  },
  validateOutput(value: unknown): asserts value is StorageRefreshOutput {
    assertSchema(
      value,
      {
        $defs: {
          StorageRoot: {
            properties: {
              name: { title: 'Name', type: 'string' },
              user: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User' },
              kind: { title: 'Kind', type: 'string' },
              state: { title: 'State', type: 'string' },
              stored_bytes: { title: 'Stored Bytes', type: 'integer' },
              reserved_bytes: { title: 'Reserved Bytes', type: 'integer' },
              quota_bytes: { title: 'Quota Bytes', type: 'integer' },
              effective_quota_bytes: { title: 'Effective Quota Bytes', type: 'integer' },
            },
            required: [
              'name',
              'user',
              'kind',
              'state',
              'stored_bytes',
              'reserved_bytes',
              'quota_bytes',
              'effective_quota_bytes',
            ],
            title: 'StorageRoot',
            type: 'object',
          },
          StorageUser: {
            properties: {
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
              full_name: { title: 'Full Name', type: 'string' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
              enabled: { title: 'Enabled', type: 'boolean' },
              is_admin: { title: 'Is Admin', type: 'boolean' },
              drive_bytes: { title: 'Drive Bytes', type: 'integer' },
              reserved_bytes: { title: 'Reserved Bytes', type: 'integer' },
              mail_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Mail Bytes' },
              combined_bytes: {
                anyOf: [{ type: 'integer' }, { type: 'null' }],
                title: 'Combined Bytes',
              },
              cap_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Cap Bytes' },
              buffer: { title: 'Buffer', type: 'boolean' },
              effective_cap_bytes: {
                anyOf: [{ type: 'integer' }, { type: 'null' }],
                title: 'Effective Cap Bytes',
              },
              mail_fetched_at: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Mail Fetched At',
              },
            },
            required: [
              'name',
              'email',
              'full_name',
              'user_image',
              'enabled',
              'is_admin',
              'drive_bytes',
              'reserved_bytes',
              'mail_bytes',
              'combined_bytes',
              'cap_bytes',
              'buffer',
              'effective_cap_bytes',
              'mail_fetched_at',
            ],
            title: 'StorageUser',
            type: 'object',
          },
        },
        properties: {
          cloud: { title: 'Cloud', type: 'boolean' },
          drive_bytes: { title: 'Drive Bytes', type: 'integer' },
          personal_drive_bytes: { title: 'Personal Drive Bytes', type: 'integer' },
          shared_drive_bytes: { title: 'Shared Drive Bytes', type: 'integer' },
          group_mail_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Group Mail Bytes',
          },
          pending_invitations: { title: 'Pending Invitations', type: 'integer' },
          reserved_bytes: { title: 'Reserved Bytes', type: 'integer' },
          mail_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Mail Bytes' },
          combined_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Combined Bytes',
          },
          allowance_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Allowance Bytes',
          },
          effective_allowance_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Effective Allowance Bytes',
          },
          stale: { title: 'Stale', type: 'boolean' },
          fetched_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Fetched At' },
          default_cap_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Default Cap Bytes',
          },
          users: { items: { $ref: '#/$defs/StorageUser' }, title: 'Users', type: 'array' },
          roots: { items: { $ref: '#/$defs/StorageRoot' }, title: 'Roots', type: 'array' },
        },
        required: [
          'cloud',
          'drive_bytes',
          'personal_drive_bytes',
          'shared_drive_bytes',
          'group_mail_bytes',
          'pending_invitations',
          'reserved_bytes',
          'mail_bytes',
          'combined_bytes',
          'allowance_bytes',
          'effective_allowance_bytes',
          'stale',
          'fetched_at',
          'default_cap_bytes',
          'users',
          'roots',
        ],
        title: 'StorageReport',
        type: 'object',
      },
      'storage_refresh output',
    )
  },
}

export const operationStorageLimits: Validators<StorageLimitsInput, StorageLimitsOutput> = {
  validateInput(value: unknown): asserts value is StorageLimitsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          users: { items: { type: 'string' }, title: 'Users', type: 'array' },
          cap_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Cap Bytes' },
          buffer: { title: 'Buffer', type: 'boolean' },
        },
        required: ['users', 'cap_bytes'],
        additionalProperties: false,
        $defs: {},
      },
      'storage_limits input',
    )
  },
  validateOutput(value: unknown): asserts value is StorageLimitsOutput {
    assertSchema(
      value,
      {
        $defs: {
          LimitResult: {
            properties: {
              user: { title: 'User', type: 'string' },
              success: { title: 'Success', type: 'boolean' },
              error: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Error' },
            },
            required: ['user', 'success', 'error'],
            title: 'LimitResult',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/LimitResult' },
        type: 'array',
      },
      'storage_limits output',
    )
  },
}

export const operationStorageDefault: Validators<StorageDefaultInput, StorageDefaultOutput> = {
  validateInput(value: unknown): asserts value is StorageDefaultInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          cap_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Cap Bytes' },
        },
        required: ['cap_bytes'],
        additionalProperties: false,
        $defs: {},
      },
      'storage_default input',
    )
  },
  validateOutput(value: unknown): asserts value is StorageDefaultOutput {
    assertSchema(
      value,
      {
        $defs: {
          StorageRoot: {
            properties: {
              name: { title: 'Name', type: 'string' },
              user: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User' },
              kind: { title: 'Kind', type: 'string' },
              state: { title: 'State', type: 'string' },
              stored_bytes: { title: 'Stored Bytes', type: 'integer' },
              reserved_bytes: { title: 'Reserved Bytes', type: 'integer' },
              quota_bytes: { title: 'Quota Bytes', type: 'integer' },
              effective_quota_bytes: { title: 'Effective Quota Bytes', type: 'integer' },
            },
            required: [
              'name',
              'user',
              'kind',
              'state',
              'stored_bytes',
              'reserved_bytes',
              'quota_bytes',
              'effective_quota_bytes',
            ],
            title: 'StorageRoot',
            type: 'object',
          },
          StorageUser: {
            properties: {
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
              full_name: { title: 'Full Name', type: 'string' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
              enabled: { title: 'Enabled', type: 'boolean' },
              is_admin: { title: 'Is Admin', type: 'boolean' },
              drive_bytes: { title: 'Drive Bytes', type: 'integer' },
              reserved_bytes: { title: 'Reserved Bytes', type: 'integer' },
              mail_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Mail Bytes' },
              combined_bytes: {
                anyOf: [{ type: 'integer' }, { type: 'null' }],
                title: 'Combined Bytes',
              },
              cap_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Cap Bytes' },
              buffer: { title: 'Buffer', type: 'boolean' },
              effective_cap_bytes: {
                anyOf: [{ type: 'integer' }, { type: 'null' }],
                title: 'Effective Cap Bytes',
              },
              mail_fetched_at: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Mail Fetched At',
              },
            },
            required: [
              'name',
              'email',
              'full_name',
              'user_image',
              'enabled',
              'is_admin',
              'drive_bytes',
              'reserved_bytes',
              'mail_bytes',
              'combined_bytes',
              'cap_bytes',
              'buffer',
              'effective_cap_bytes',
              'mail_fetched_at',
            ],
            title: 'StorageUser',
            type: 'object',
          },
        },
        properties: {
          cloud: { title: 'Cloud', type: 'boolean' },
          drive_bytes: { title: 'Drive Bytes', type: 'integer' },
          personal_drive_bytes: { title: 'Personal Drive Bytes', type: 'integer' },
          shared_drive_bytes: { title: 'Shared Drive Bytes', type: 'integer' },
          group_mail_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Group Mail Bytes',
          },
          pending_invitations: { title: 'Pending Invitations', type: 'integer' },
          reserved_bytes: { title: 'Reserved Bytes', type: 'integer' },
          mail_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Mail Bytes' },
          combined_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Combined Bytes',
          },
          allowance_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Allowance Bytes',
          },
          effective_allowance_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Effective Allowance Bytes',
          },
          stale: { title: 'Stale', type: 'boolean' },
          fetched_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Fetched At' },
          default_cap_bytes: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Default Cap Bytes',
          },
          users: { items: { $ref: '#/$defs/StorageUser' }, title: 'Users', type: 'array' },
          roots: { items: { $ref: '#/$defs/StorageRoot' }, title: 'Roots', type: 'array' },
        },
        required: [
          'cloud',
          'drive_bytes',
          'personal_drive_bytes',
          'shared_drive_bytes',
          'group_mail_bytes',
          'pending_invitations',
          'reserved_bytes',
          'mail_bytes',
          'combined_bytes',
          'allowance_bytes',
          'effective_allowance_bytes',
          'stale',
          'fetched_at',
          'default_cap_bytes',
          'users',
          'roots',
        ],
        title: 'StorageReport',
        type: 'object',
      },
      'storage_default output',
    )
  },
}

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
              must_change_password: { title: 'Must Change Password', type: 'boolean' },
              setup_required: { title: 'Setup Required', type: 'boolean' },
            },
            required: [
              'name',
              'email',
              'full_name',
              'avatar',
              'roles',
              'is_jmap_configured',
              'must_change_password',
              'setup_required',
            ],
            title: 'Account',
            type: 'object',
          },
          AccountRoles: {
            properties: {
              system_manager: { title: 'System Manager', type: 'boolean' },
              suite_admin: { title: 'Suite Admin', type: 'boolean' },
            },
            required: ['system_manager', 'suite_admin'],
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
              enabled: { title: 'Enabled', type: 'boolean' },
              account: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Account' },
              setup_status: { title: 'Setup Status', type: 'string' },
              must_change_password: { title: 'Must Change Password', type: 'boolean' },
            },
            required: [
              'name',
              'email',
              'full_name',
              'user_image',
              'is_admin',
              'enabled',
              'account',
              'setup_status',
              'must_change_password',
            ],
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

export const operationUsersPatch: Validators<UsersPatchInput, UsersPatchOutput> = {
  validateInput(value: unknown): asserts value is UsersPatchInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          user: { title: 'User', type: 'string' },
          is_admin: { title: 'Is Admin', type: 'boolean' },
          enabled: { title: 'Enabled', type: 'boolean' },
          full_name: { title: 'Full Name', type: 'string' },
        },
        required: ['user'],
        additionalProperties: false,
        $defs: {},
      },
      'users_patch input',
    )
  },
  validateOutput(value: unknown): asserts value is UsersPatchOutput {
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
              enabled: { title: 'Enabled', type: 'boolean' },
              account: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Account' },
              setup_status: { title: 'Setup Status', type: 'string' },
              must_change_password: { title: 'Must Change Password', type: 'boolean' },
            },
            required: [
              'name',
              'email',
              'full_name',
              'user_image',
              'is_admin',
              'enabled',
              'account',
              'setup_status',
              'must_change_password',
            ],
            title: 'User',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/User' },
        type: 'array',
      },
      'users_patch output',
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
