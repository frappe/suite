// Generated from src/apps/mail/client/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  AccountPreferencesInput,
  AccountPreferencesOutput,
  AddAddressBookInput,
  AddAddressBookOutput,
  AddContactCardInput,
  AddContactCardOutput,
  AddDomainInput,
  AddDomainOutput,
  AddGroupEmailInput,
  AddGroupEmailOutput,
  AddGroupInput,
  AddGroupMembersInput,
  AddGroupMembersOutput,
  AddGroupOutput,
  AddIdentityInput,
  AddIdentityOutput,
  AddMailingListEmailInput,
  AddMailingListEmailOutput,
  AddMailingListInput,
  AddMailingListOutput,
  AddMailingListRecipientsInput,
  AddMailingListRecipientsOutput,
  AddMailsToMailboxInput,
  AddMailsToMailboxOutput,
  AddMemberEmailInput,
  AddMemberEmailOutput,
  AddMemberInput,
  AddMemberOutput,
  AddMemberToGroupsInput,
  AddMemberToGroupsOutput,
  AddMemberToMailingListsInput,
  AddMemberToMailingListsOutput,
  AddParticipantIdentityInput,
  AddParticipantIdentityOutput,
  AddPushSubscriptionInput,
  AddPushSubscriptionOutput,
  AllowScreeningSendersInput,
  AllowScreeningSendersOutput,
  BlockSendersInput,
  BlockSendersOutput,
  BookInput,
  BookOutput,
  CancelScheduledMailInput,
  CancelScheduledMailOutput,
  ChangeMemberPasswordInput,
  ChangeMemberPasswordOutput,
  ContactCardAddToAddressBookInput,
  ContactCardAddToAddressBookOutput,
  ContactCardRemoveFromAddressBookInput,
  ContactCardRemoveFromAddressBookOutput,
  ContactInput,
  ContactOutput,
  CreateAccountInput,
  CreateAccountOutput,
  CreateAutomationScriptInput,
  CreateAutomationScriptOutput,
  CreateCalendarExportInput,
  CreateCalendarExportOutput,
  CreateCalendarImportInput,
  CreateCalendarImportOutput,
  CreateContactsExportInput,
  CreateContactsExportOutput,
  CreateContactsImportInput,
  CreateContactsImportOutput,
  CreateMailboxInput,
  CreateMailboxOutput,
  CreateMailExportInput,
  CreateMailExportOutput,
  CreateMailImportInput,
  CreateMailImportOutput,
  CreateMailInput,
  CreateMailOutput,
  CreateSieveScriptInput,
  CreateSieveScriptOutput,
  CreateSignatureInput,
  CreateSignatureOutput,
  CredentialsInput,
  CredentialsOutput,
  DeleteAccountRequestsInput,
  DeleteAccountRequestsOutput,
  DeleteAddressBooksInput,
  DeleteAddressBooksOutput,
  DeleteContactCardsInput,
  DeleteContactCardsOutput,
  DeleteDomainInput,
  DeleteDomainOutput,
  DeleteGroupsInput,
  DeleteGroupsOutput,
  DeleteIdentityNamesInput,
  DeleteIdentityNamesOutput,
  DeleteMailboxInput,
  DeleteMailboxOutput,
  DeleteMailingListsInput,
  DeleteMailingListsOutput,
  DeleteMailInput,
  DeleteMailOutput,
  DeleteMembersInput,
  DeleteMembersOutput,
  DeleteMessagesInput,
  DeleteMessagesOutput,
  DeleteParticipantIdentitiesInput,
  DeleteParticipantIdentitiesOutput,
  DeletePushSubscriptionsInput,
  DeletePushSubscriptionsOutput,
  DeleteSieveScriptInput,
  DeleteSieveScriptOutput,
  DeleteSignatureInput,
  DeleteSignatureOutput,
  DisableMembersInput,
  DisableMembersOutput,
  DismissFailedMailInput,
  DismissFailedMailOutput,
  EmptyUserMailboxInput,
  EmptyUserMailboxOutput,
  EnableMembersInput,
  EnableMembersOutput,
  ExchangeAttachmentInput,
  ExchangeAttachmentOutput,
  ExchangeInput,
  ExchangeListInput,
  ExchangeListOutput,
  ExchangeOutput,
  FetchAttachmentInput,
  FetchAttachmentOutput,
  FetchAttachmentsAsZipInput,
  FetchAttachmentsAsZipOutput,
  FetchMailAsEmlInput,
  FetchMailAsEmlOutput,
  FetchPushSubscriptionsInput,
  FetchPushSubscriptionsOutput,
  GetAccountOptionsInput,
  GetAccountOptionsOutput,
  GetAccountRequestInput,
  GetAccountRequestOutput,
  GetAccountRequestsInput,
  GetAccountRequestsOutput,
  GetAccountSetupOptionsInput,
  GetAccountSetupOptionsOutput,
  GetAccountsInput,
  GetAccountsOutput,
  GetAddressBookContactCountInput,
  GetAddressBookContactCountOutput,
  GetAddressBooksInput,
  GetAddressBooksOutput,
  GetAllInboxUnreadCountInput,
  GetAllInboxUnreadCountOutput,
  GetBrandingInput,
  GetBrandingOutput,
  GetCalendarClientConfigInput,
  GetCalendarClientConfigOutput,
  GetContactCardsInput,
  GetContactCardsOutput,
  GetContactsInput,
  GetContactsOutput,
  GetDeliveryStatusInput,
  GetDeliveryStatusOutput,
  GetDmarcReportInput,
  GetDmarcReportOutput,
  GetDmarcReportsInput,
  GetDmarcReportsOutput,
  GetDmarcSummaryInput,
  GetDmarcSummaryOutput,
  GetDomainDnsCsvInput,
  GetDomainDnsCsvOutput,
  GetDomainDnsJsonInput,
  GetDomainDnsJsonOutput,
  GetDomainDnsZoneInput,
  GetDomainDnsZoneOutput,
  GetDomainInput,
  GetDomainOutput,
  GetDomainOwnershipRecordInput,
  GetDomainOwnershipRecordOutput,
  GetDomainsInput,
  GetDomainsOutput,
  GetEmailSuggestionsInput,
  GetEmailSuggestionsOutput,
  GetEnabledDomainsInput,
  GetEnabledDomainsOutput,
  GetGlobalScreenedAddressesInput,
  GetGlobalScreenedAddressesOutput,
  GetGroupInput,
  GetGroupOutput,
  GetGroupsInput,
  GetGroupsOutput,
  GetIdentitiesInput,
  GetIdentitiesOutput,
  GetMailboxesInput,
  GetMailboxesOutput,
  GetMailClientConfigInput,
  GetMailClientConfigOutput,
  GetMailingListInput,
  GetMailingListOutput,
  GetMailingListRecipientsInput,
  GetMailingListRecipientsOutput,
  GetMailingListsInput,
  GetMailingListsOutput,
  GetMemberInput,
  GetMemberOutput,
  GetMembersInput,
  GetMembersOutput,
  GetMimeMessageInput,
  GetMimeMessageOutput,
  GetOverviewInput,
  GetOverviewOutput,
  GetParticipantIdentitiesInput,
  GetParticipantIdentitiesOutput,
  GetQuotaInput,
  GetQuotaOutput,
  GetScheduledMailInput,
  GetScheduledMailOutput,
  GetScreenedAddressesInput,
  GetScreenedAddressesOutput,
  GetSieveScriptsInput,
  GetSieveScriptsOutput,
  GetSignupDomainsInput,
  GetSignupDomainsOutput,
  GetSignupSettingsInput,
  GetSignupSettingsOutput,
  GetSubmissionsInput,
  GetSubmissionsOutput,
  GetThreadInput,
  GetThreadOutput,
  GetThreadsInput,
  GetThreadsOutput,
  GetTlsReportInput,
  GetTlsReportOutput,
  GetTlsReportsInput,
  GetTlsReportsOutput,
  GetTlsSummaryInput,
  GetTlsSummaryOutput,
  GetUnifiedFoldersInput,
  GetUnifiedFoldersOutput,
  GetUnifiedThreadsInput,
  GetUnifiedThreadsOutput,
  GetUserForResetPasswordKeyInput,
  GetUserForResetPasswordKeyOutput,
  GetUserInfoInput,
  GetUserInfoOutput,
  GetVacationResponseInput,
  GetVacationResponseOutput,
  InboxSummaryInput,
  InboxSummaryOutput,
  InviteInput,
  InviteOutput,
  JunkSendersInboxMailInput,
  JunkSendersInboxMailOutput,
  MoveMailsInput,
  MoveMailsOutput,
  OngoingCalendarExchangeInput,
  OngoingCalendarExchangeOutput,
  OngoingExchangeInput,
  OngoingExchangeOutput,
  RebuildAutomationScriptForAccountInput,
  RebuildAutomationScriptForAccountOutput,
  RemoveGroupEmailInput,
  RemoveGroupEmailOutput,
  RemoveGroupMemberInput,
  RemoveGroupMemberOutput,
  RemoveMailingListEmailInput,
  RemoveMailingListEmailOutput,
  RemoveMailingListRecipientInput,
  RemoveMailingListRecipientOutput,
  RemoveMailsFromMailboxInput,
  RemoveMailsFromMailboxOutput,
  RemoveMemberEmailInput,
  RemoveMemberEmailOutput,
  RemoveMemberFromGroupInput,
  RemoveMemberFromGroupOutput,
  RemoveMemberFromMailingListInput,
  RemoveMemberFromMailingListOutput,
  RenewPushSubscriptionInput,
  RenewPushSubscriptionOutput,
  RescheduleMailInput,
  RescheduleMailOutput,
  ResendOtpInput,
  ResendOtpOutput,
  RetryFailedMailInput,
  RetryFailedMailOutput,
  SaveIdentityInput,
  SaveIdentityOutput,
  ScreenEmailAddressesInput,
  ScreenEmailAddressesOutput,
  ScreenEmailAddressInput,
  ScreenEmailAddressOutput,
  ScreenOutSendersInput,
  ScreenOutSendersOutput,
  SearchMailsInput,
  SearchMailsOutput,
  SendInviteInput,
  SendInviteOutput,
  SendResetPasswordLinkInput,
  SendResetPasswordLinkOutput,
  SendScheduledMailNowInput,
  SendScheduledMailNowOutput,
  SetDomainEnabledInput,
  SetDomainEnabledOutput,
  SetFlaggedInput,
  SetFlaggedOutput,
  SetGroupEmailEnabledInput,
  SetGroupEmailEnabledOutput,
  SetGroupReceivingEnabledInput,
  SetGroupReceivingEnabledOutput,
  SetMailingListEmailEnabledInput,
  SetMailingListEmailEnabledOutput,
  SetMailsMailboxesInput,
  SetMailsMailboxesOutput,
  SetMailsSeenInput,
  SetMailsSeenOutput,
  SetMailsSpamStatusInput,
  SetMailsSpamStatusOutput,
  SetMemberEmailEnabledInput,
  SetMemberEmailEnabledOutput,
  SetMemberReceivingEnabledInput,
  SetMemberReceivingEnabledOutput,
  SetSignatureInput,
  SetSignatureOutput,
  SignaturesInput,
  SignaturesOutput,
  SignupInput,
  SignupOutput,
  SubscribeMailboxInput,
  SubscribeMailboxOutput,
  UndoScreeningVerdictInput,
  UndoScreeningVerdictOutput,
  UnscreenEmailAddressesInput,
  UnscreenEmailAddressesOutput,
  UpdateAccountPreferencesInput,
  UpdateAccountPreferencesOutput,
  UpdateBookInput,
  UpdateBookOutput,
  UpdateContactInput,
  UpdateContactOutput,
  UpdateCredentialsInput,
  UpdateCredentialsOutput,
  UpdateDomainInput,
  UpdateDomainOutput,
  UpdateDraftMailInput,
  UpdateDraftMailOutput,
  UpdateGroupInput,
  UpdateGroupOutput,
  UpdateInviteInput,
  UpdateInviteOutput,
  UpdateMailboxInput,
  UpdateMailboxOutput,
  UpdateMailingListInput,
  UpdateMailingListOutput,
  UpdateMemberInput,
  UpdateMemberOutput,
  UpdateParticipantIdentityInput,
  UpdateParticipantIdentityOutput,
  UpdatePreferencesInput,
  UpdatePreferencesOutput,
  UpdateSieveScriptInput,
  UpdateSieveScriptOutput,
  UpdateSignatureInput,
  UpdateSignatureOutput,
  UpdateVacationResponseInput,
  UpdateVacationResponseOutput,
  ValidateEmailAssignedInput,
  ValidateEmailAssignedOutput,
  VerifyDomainInput,
  VerifyDomainOutput,
  VerifyOtpInput,
  VerifyOtpOutput,
} from './generated'

export const operationInboxSummary: Validators<InboxSummaryInput, InboxSummaryOutput> = {
  validateInput(value: unknown): asserts value is InboxSummaryInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'inbox_summary input',
    )
  },
  validateOutput(value: unknown): asserts value is InboxSummaryOutput {
    assertSchema(
      value,
      {
        properties: { unread: { title: 'Unread', type: 'integer' } },
        required: ['unread'],
        title: 'InboxSummary',
        type: 'object',
      },
      'inbox_summary output',
    )
  },
}

export const operationExchange: Validators<ExchangeInput, ExchangeOutput> = {
  validateInput(value: unknown): asserts value is ExchangeInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          doctype: {
            enum: ['Mail Exchange', 'Contacts Exchange', 'Calendar Exchange'],
            title: 'Doctype',
            type: 'string',
          },
          name: { title: 'Name', type: 'string' },
        },
        required: ['doctype', 'name'],
        additionalProperties: false,
        $defs: {},
      },
      'exchange input',
    )
  },
  validateOutput(value: unknown): asserts value is ExchangeOutput {
    assertSchema(
      value,
      {
        properties: {
          name: { title: 'Name', type: 'string' },
          status: { title: 'Status', type: 'string' },
          operation: { title: 'Operation', type: 'string' },
          started_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Started At' },
          completed_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Completed At' },
          output: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Output' },
          import_format: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Import Format' },
          export_format: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Export Format' },
          export_archive_type: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Export Archive Type',
          },
        },
        required: [
          'name',
          'status',
          'operation',
          'started_at',
          'completed_at',
          'output',
          'import_format',
          'export_format',
          'export_archive_type',
        ],
        title: 'Job',
        type: 'object',
      },
      'exchange output',
    )
  },
}

export const operationExchangeAttachment: Validators<
  ExchangeAttachmentInput,
  ExchangeAttachmentOutput
> = {
  validateInput(value: unknown): asserts value is ExchangeAttachmentInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          doctype: {
            enum: ['Mail Exchange', 'Contacts Exchange', 'Calendar Exchange'],
            title: 'Doctype',
            type: 'string',
          },
          name: { title: 'Name', type: 'string' },
        },
        required: ['doctype', 'name'],
        additionalProperties: false,
        $defs: {},
      },
      'exchange_attachment input',
    )
  },
  validateOutput(value: unknown): asserts value is ExchangeAttachmentOutput {
    assertSchema(
      value,
      {
        $defs: {
          Attachment: {
            properties: {
              file_name: { title: 'File Name', type: 'string' },
              file_url: { title: 'File Url', type: 'string' },
              file_type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'File Type' },
              file_size: { title: 'File Size', type: 'integer' },
            },
            required: ['file_name', 'file_url', 'file_type', 'file_size'],
            title: 'Attachment',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/Attachment' }, { type: 'null' }],
      },
      'exchange_attachment output',
    )
  },
}

export const operationExchangeList: Validators<ExchangeListInput, ExchangeListOutput> = {
  validateInput(value: unknown): asserts value is ExchangeListInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          doctype: {
            enum: ['Mail Exchange', 'Contacts Exchange', 'Calendar Exchange'],
            title: 'Doctype',
            type: 'string',
          },
          operation: { enum: ['Import', 'Export'], title: 'Operation', type: 'string' },
          status: { title: 'Status', type: 'string' },
          start: { title: 'Start', type: 'integer' },
          page_length: { title: 'Page Length', type: 'integer' },
        },
        required: ['doctype', 'operation'],
        additionalProperties: false,
        $defs: {},
      },
      'exchange_list input',
    )
  },
  validateOutput(value: unknown): asserts value is ExchangeListOutput {
    assertSchema(
      value,
      {
        $defs: {
          Job: {
            properties: {
              name: { title: 'Name', type: 'string' },
              status: { title: 'Status', type: 'string' },
              operation: { title: 'Operation', type: 'string' },
              started_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Started At' },
              completed_at: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Completed At',
              },
              output: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Output' },
              import_format: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Import Format',
              },
              export_format: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Export Format',
              },
              export_archive_type: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Export Archive Type',
              },
            },
            required: [
              'name',
              'status',
              'operation',
              'started_at',
              'completed_at',
              'output',
              'import_format',
              'export_format',
              'export_archive_type',
            ],
            title: 'Job',
            type: 'object',
          },
        },
        properties: {
          items: { items: { $ref: '#/$defs/Job' }, title: 'Items', type: 'array' },
          total: { title: 'Total', type: 'integer' },
        },
        required: ['items', 'total'],
        title: 'JobPage',
        type: 'object',
      },
      'exchange_list output',
    )
  },
}

export const operationCredentials: Validators<CredentialsInput, CredentialsOutput> = {
  validateInput(value: unknown): asserts value is CredentialsInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'credentials input',
    )
  },
  validateOutput(value: unknown): asserts value is CredentialsOutput {
    assertSchema(
      value,
      {
        properties: {
          server_url: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Server Url' },
          username: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Username' },
          backup_email: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Backup Email' },
          has_password: { title: 'Has Password', type: 'boolean' },
        },
        required: ['server_url', 'username', 'backup_email', 'has_password'],
        title: 'Credentials',
        type: 'object',
      },
      'credentials output',
    )
  },
}

export const operationUpdateCredentials: Validators<
  UpdateCredentialsInput,
  UpdateCredentialsOutput
> = {
  validateInput(value: unknown): asserts value is UpdateCredentialsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          username: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Username' },
          backup_email: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Backup Email' },
          app_password: { title: 'App Password', type: 'string' },
        },
        required: ['username', 'backup_email'],
        additionalProperties: false,
        $defs: {},
      },
      'update_credentials input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateCredentialsOutput {
    assertSchema(value, { type: 'null' }, 'update_credentials output')
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
          group_messages_by: {
            anyOf: [{ enum: ['None', 'Day', 'Month'], type: 'string' }, { type: 'null' }],
            title: 'Group Messages By',
          },
          show_reading_pane: { enum: [0, 1], title: 'Show Reading Pane', type: 'integer' },
          undo_send_period: {
            enum: ['5', '10', '20', '30'],
            title: 'Undo Send Period',
            type: 'string',
          },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'update_preferences input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdatePreferencesOutput {
    assertSchema(value, { type: 'null' }, 'update_preferences output')
  },
}

export const operationAccountPreferences: Validators<
  AccountPreferencesInput,
  AccountPreferencesOutput
> = {
  validateInput(value: unknown): asserts value is AccountPreferencesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { account: { title: 'Account', type: 'string' } },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'account_preferences input',
    )
  },
  validateOutput(value: unknown): asserts value is AccountPreferencesOutput {
    assertSchema(
      value,
      {
        properties: {
          create_contacts_after_email_submit: {
            enum: [0, 1],
            title: 'Create Contacts After Email Submit',
            type: 'integer',
          },
          destroy_email_after_submit: {
            enum: [0, 1],
            title: 'Destroy Email After Submit',
            type: 'integer',
          },
          destroy_newsletter_after_submit: {
            enum: [0, 1],
            title: 'Destroy Newsletter After Submit',
            type: 'integer',
          },
          keep_forwarded_email_in_thread: {
            enum: [0, 1],
            title: 'Keep Forwarded Email In Thread',
            type: 'integer',
          },
          enable_screening: { enum: [0, 1], title: 'Enable Screening', type: 'integer' },
          block_remote_images: { enum: [0, 1], title: 'Block Remote Images', type: 'integer' },
          on_block_old_mail: {
            enum: ['Ask', 'Move to Junk', 'Keep'],
            title: 'On Block Old Mail',
            type: 'string',
          },
          default_outgoing_email: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Default Outgoing Email',
          },
        },
        required: [
          'create_contacts_after_email_submit',
          'destroy_email_after_submit',
          'destroy_newsletter_after_submit',
          'keep_forwarded_email_in_thread',
          'enable_screening',
          'block_remote_images',
          'on_block_old_mail',
          'default_outgoing_email',
        ],
        title: 'AccountPreferences',
        type: 'object',
      },
      'account_preferences output',
    )
  },
}

export const operationUpdateAccountPreferences: Validators<
  UpdateAccountPreferencesInput,
  UpdateAccountPreferencesOutput
> = {
  validateInput(value: unknown): asserts value is UpdateAccountPreferencesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          changes: { $ref: '#/$defs/AccountChanges' },
        },
        required: ['account', 'changes'],
        additionalProperties: false,
        $defs: {
          AccountChanges: {
            properties: {
              create_contacts_after_email_submit: {
                enum: [0, 1],
                title: 'Create Contacts After Email Submit',
                type: 'integer',
              },
              destroy_email_after_submit: {
                enum: [0, 1],
                title: 'Destroy Email After Submit',
                type: 'integer',
              },
              destroy_newsletter_after_submit: {
                enum: [0, 1],
                title: 'Destroy Newsletter After Submit',
                type: 'integer',
              },
              keep_forwarded_email_in_thread: {
                enum: [0, 1],
                title: 'Keep Forwarded Email In Thread',
                type: 'integer',
              },
              enable_screening: { enum: [0, 1], title: 'Enable Screening', type: 'integer' },
              block_remote_images: { enum: [0, 1], title: 'Block Remote Images', type: 'integer' },
              on_block_old_mail: {
                enum: ['Ask', 'Move to Junk', 'Keep'],
                title: 'On Block Old Mail',
                type: 'string',
              },
              default_outgoing_email: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Default Outgoing Email',
              },
            },
            title: 'AccountChanges',
            type: 'object',
          },
        },
      },
      'update_account_preferences input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateAccountPreferencesOutput {
    assertSchema(value, { type: 'null' }, 'update_account_preferences output')
  },
}

export const operationSubscribeMailbox: Validators<SubscribeMailboxInput, SubscribeMailboxOutput> =
  {
    validateInput(value: unknown): asserts value is SubscribeMailboxInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: {
            name: { title: 'Name', type: 'string' },
            subscribed: { enum: [0, 1], title: 'Subscribed', type: 'integer' },
          },
          required: ['name', 'subscribed'],
          additionalProperties: false,
          $defs: {},
        },
        'subscribe_mailbox input',
      )
    },
    validateOutput(value: unknown): asserts value is SubscribeMailboxOutput {
      assertSchema(value, { type: 'null' }, 'subscribe_mailbox output')
    },
  }

export const operationSaveIdentity: Validators<SaveIdentityInput, SaveIdentityOutput> = {
  validateInput(value: unknown): asserts value is SaveIdentityInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
          name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Name' },
          reply_to: { items: { $ref: '#/$defs/Address' }, title: 'Reply To', type: 'array' },
          bcc: { items: { $ref: '#/$defs/Address' }, title: 'Bcc', type: 'array' },
          html_signature: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Html Signature',
          },
        },
        required: ['account', 'id', 'name', 'reply_to', 'bcc', 'html_signature'],
        additionalProperties: false,
        $defs: {
          Address: {
            properties: {
              display_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Display Name',
              },
              email: { title: 'Email', type: 'string' },
            },
            required: ['display_name', 'email'],
            title: 'Address',
            type: 'object',
          },
        },
      },
      'save_identity input',
    )
  },
  validateOutput(value: unknown): asserts value is SaveIdentityOutput {
    assertSchema(value, { type: 'null' }, 'save_identity output')
  },
}

export const operationSignatures: Validators<SignaturesInput, SignaturesOutput> = {
  validateInput(value: unknown): asserts value is SignaturesInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'signatures input',
    )
  },
  validateOutput(value: unknown): asserts value is SignaturesOutput {
    assertSchema(
      value,
      {
        $defs: {
          Signature: {
            properties: {
              name: { title: 'Name', type: 'string' },
              signature_name: { title: 'Signature Name', type: 'string' },
              html_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Html Body' },
            },
            required: ['name', 'signature_name', 'html_body'],
            title: 'Signature',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/Signature' },
        type: 'array',
      },
      'signatures output',
    )
  },
}

export const operationCreateSignature: Validators<CreateSignatureInput, CreateSignatureOutput> = {
  validateInput(value: unknown): asserts value is CreateSignatureInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          signature_name: { title: 'Signature Name', type: 'string' },
          html_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Html Body' },
        },
        required: ['signature_name', 'html_body'],
        additionalProperties: false,
        $defs: {},
      },
      'create_signature input',
    )
  },
  validateOutput(value: unknown): asserts value is CreateSignatureOutput {
    assertSchema(value, { type: 'string' }, 'create_signature output')
  },
}

export const operationUpdateSignature: Validators<UpdateSignatureInput, UpdateSignatureOutput> = {
  validateInput(value: unknown): asserts value is UpdateSignatureInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          signature_name: { title: 'Signature Name', type: 'string' },
          html_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Html Body' },
          name: { title: 'Name', type: 'string' },
        },
        required: ['signature_name', 'html_body', 'name'],
        additionalProperties: false,
        $defs: {},
      },
      'update_signature input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateSignatureOutput {
    assertSchema(value, { type: 'null' }, 'update_signature output')
  },
}

export const operationDeleteSignature: Validators<DeleteSignatureInput, DeleteSignatureOutput> = {
  validateInput(value: unknown): asserts value is DeleteSignatureInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { title: 'Name', type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_signature input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteSignatureOutput {
    assertSchema(value, { type: 'null' }, 'delete_signature output')
  },
}

export const operationInvite: Validators<InviteInput, InviteOutput> = {
  validateInput(value: unknown): asserts value is InviteInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'invite input',
    )
  },
  validateOutput(value: unknown): asserts value is InviteOutput {
    assertSchema(
      value,
      {
        properties: {
          name: { title: 'Name', type: 'string' },
          account: { title: 'Account', type: 'string' },
          aliases: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Aliases' },
          is_admin: { enum: [0, 1], title: 'Is Admin', type: 'integer' },
          backup_email: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Backup Email' },
          invited_by: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Invited By' },
          expires_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires At' },
          quota_gb: { anyOf: [{ type: 'number' }, { type: 'null' }], title: 'Quota Gb' },
          send_invite: { enum: [0, 1], title: 'Send Invite', type: 'integer' },
          disable_receiving: { enum: [0, 1], title: 'Disable Receiving', type: 'integer' },
          is_verified: { enum: [0, 1], title: 'Is Verified', type: 'integer' },
          groups: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Groups' },
          mailing_lists: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Mailing Lists' },
        },
        required: [
          'name',
          'account',
          'aliases',
          'is_admin',
          'backup_email',
          'invited_by',
          'expires_at',
          'quota_gb',
          'send_invite',
          'disable_receiving',
          'is_verified',
          'groups',
          'mailing_lists',
        ],
        title: 'Invite',
        type: 'object',
      },
      'invite output',
    )
  },
}

export const operationUpdateInvite: Validators<UpdateInviteInput, UpdateInviteOutput> = {
  validateInput(value: unknown): asserts value is UpdateInviteInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          expires_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires At' },
          quota_gb: { anyOf: [{ type: 'number' }, { type: 'null' }], title: 'Quota Gb' },
        },
        required: ['name', 'expires_at', 'quota_gb'],
        additionalProperties: false,
        $defs: {},
      },
      'update_invite input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateInviteOutput {
    assertSchema(value, { type: 'null' }, 'update_invite output')
  },
}

export const operationSendInvite: Validators<SendInviteInput, SendInviteOutput> = {
  validateInput(value: unknown): asserts value is SendInviteInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { title: 'Name', type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'send_invite input',
    )
  },
  validateOutput(value: unknown): asserts value is SendInviteOutput {
    assertSchema(value, { type: 'null' }, 'send_invite output')
  },
}

export const operationContact: Validators<ContactInput, ContactOutput> = {
  validateInput(value: unknown): asserts value is ContactInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
        },
        required: ['account', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'contact input',
    )
  },
  validateOutput(value: unknown): asserts value is ContactOutput {
    assertSchema(
      value,
      {
        $defs: {
          BookMembership: {
            properties: {
              address_book: { title: 'Address Book', type: 'string' },
              address_book_id: { title: 'Address Book Id', type: 'string' },
              address_book_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Address Book Name',
              },
            },
            required: ['address_book', 'address_book_id', 'address_book_name'],
            title: 'BookMembership',
            type: 'object',
          },
          Email: {
            properties: {
              address: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Address' },
              type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Type' },
              label: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Label' },
              contexts: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Contexts' },
            },
            required: ['address'],
            title: 'Email',
            type: 'object',
          },
          Phone: {
            properties: {
              number: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Number' },
              type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Type' },
              label: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Label' },
              contexts: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Contexts' },
            },
            required: ['number'],
            title: 'Phone',
            type: 'object',
          },
          PostalAddress: {
            properties: {
              idx: { title: 'Idx', type: 'integer' },
              type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Type' },
              street: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Street' },
              locality: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Locality' },
              region: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Region' },
              postcode: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Postcode' },
              country: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Country' },
              time_zone: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Time Zone' },
              contexts: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Contexts' },
            },
            title: 'PostalAddress',
            type: 'object',
          },
        },
        properties: {
          id: { title: 'Id', type: 'string' },
          full_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Full Name' },
          kind: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Kind' },
          emails: { items: { $ref: '#/$defs/Email' }, title: 'Emails', type: 'array' },
          name: { title: 'Name', type: 'string' },
          account: { title: 'Account', type: 'string' },
          uid: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Uid' },
          name_breakup: { title: 'Name Breakup', type: 'string' },
          address_books: {
            items: { $ref: '#/$defs/BookMembership' },
            title: 'Address Books',
            type: 'array',
          },
          phones: { items: { $ref: '#/$defs/Phone' }, title: 'Phones', type: 'array' },
          addresses: {
            items: { $ref: '#/$defs/PostalAddress' },
            title: 'Addresses',
            type: 'array',
          },
          created_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created At' },
          updated_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Updated At' },
          creation: { title: 'Creation', type: 'string' },
          modified: { title: 'Modified', type: 'string' },
        },
        required: [
          'id',
          'full_name',
          'kind',
          'emails',
          'name',
          'account',
          'uid',
          'name_breakup',
          'address_books',
          'phones',
          'addresses',
          'created_at',
          'updated_at',
          'creation',
          'modified',
        ],
        title: 'Contact',
        type: 'object',
      },
      'contact output',
    )
  },
}

export const operationUpdateContact: Validators<UpdateContactInput, UpdateContactOutput> = {
  validateInput(value: unknown): asserts value is UpdateContactInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
          changes: { $ref: '#/$defs/CardChanges' },
        },
        required: ['account', 'id', 'changes'],
        additionalProperties: false,
        $defs: {
          BookMembership: {
            properties: {
              address_book: { title: 'Address Book', type: 'string' },
              address_book_id: { title: 'Address Book Id', type: 'string' },
              address_book_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Address Book Name',
              },
            },
            required: ['address_book', 'address_book_id', 'address_book_name'],
            title: 'BookMembership',
            type: 'object',
          },
          CardChanges: {
            properties: {
              full_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Full Name' },
              kind: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Kind' },
              emails: { items: { $ref: '#/$defs/Email' }, title: 'Emails', type: 'array' },
              phones: { items: { $ref: '#/$defs/Phone' }, title: 'Phones', type: 'array' },
              addresses: {
                items: { $ref: '#/$defs/PostalAddress' },
                title: 'Addresses',
                type: 'array',
              },
              address_books: {
                items: { $ref: '#/$defs/BookMembership' },
                title: 'Address Books',
                type: 'array',
              },
            },
            title: 'CardChanges',
            type: 'object',
          },
          Email: {
            properties: {
              address: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Address' },
              type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Type' },
              label: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Label' },
              contexts: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Contexts' },
            },
            required: ['address'],
            title: 'Email',
            type: 'object',
          },
          Phone: {
            properties: {
              number: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Number' },
              type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Type' },
              label: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Label' },
              contexts: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Contexts' },
            },
            required: ['number'],
            title: 'Phone',
            type: 'object',
          },
          PostalAddress: {
            properties: {
              idx: { title: 'Idx', type: 'integer' },
              type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Type' },
              street: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Street' },
              locality: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Locality' },
              region: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Region' },
              postcode: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Postcode' },
              country: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Country' },
              time_zone: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Time Zone' },
              contexts: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Contexts' },
            },
            title: 'PostalAddress',
            type: 'object',
          },
        },
      },
      'update_contact input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateContactOutput {
    assertSchema(value, { type: 'null' }, 'update_contact output')
  },
}

export const operationBook: Validators<BookInput, BookOutput> = {
  validateInput(value: unknown): asserts value is BookInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
        },
        required: ['account', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'book input',
    )
  },
  validateOutput(value: unknown): asserts value is BookOutput {
    assertSchema(
      value,
      {
        properties: {
          name: { title: 'Name', type: 'string' },
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
          _name: { title: 'Name', type: 'string' },
          sort_order: { title: 'Sort Order', type: 'integer' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
          default: { enum: [0, 1], type: 'integer', title: 'Default' },
          subscribed: { enum: [0, 1], title: 'Subscribed', type: 'integer' },
          may_read: { enum: [0, 1], title: 'May Read', type: 'integer' },
          may_write: { enum: [0, 1], title: 'May Write', type: 'integer' },
          may_admin: { enum: [0, 1], title: 'May Admin', type: 'integer' },
          may_delete: { enum: [0, 1], title: 'May Delete', type: 'integer' },
          creation: { title: 'Creation', type: 'string' },
          modified: { title: 'Modified', type: 'string' },
        },
        required: [
          'name',
          'account',
          'id',
          '_name',
          'sort_order',
          'description',
          'default',
          'subscribed',
          'may_read',
          'may_write',
          'may_admin',
          'may_delete',
          'creation',
          'modified',
        ],
        title: 'AddressBook',
        type: 'object',
      },
      'book output',
    )
  },
}

export const operationUpdateBook: Validators<UpdateBookInput, UpdateBookOutput> = {
  validateInput(value: unknown): asserts value is UpdateBookInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
          changes: { $ref: '#/$defs/BookChanges' },
        },
        required: ['account', 'id', 'changes'],
        additionalProperties: false,
        $defs: {
          BookChanges: {
            properties: {
              _name: { title: 'Name', type: 'string' },
              description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
              sort_order: { title: 'Sort Order', type: 'integer' },
              default: {
                anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
                title: 'Default',
              },
              subscribed: {
                anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
                title: 'Subscribed',
              },
            },
            title: 'BookChanges',
            type: 'object',
          },
        },
      },
      'update_book input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateBookOutput {
    assertSchema(value, { type: 'null' }, 'update_book output')
  },
}

export const operationGetUserInfo: Validators<GetUserInfoInput, GetUserInfoOutput> = {
  validateInput(value: unknown): asserts value is GetUserInfoInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_user_info input',
    )
  },
  validateOutput(value: unknown): asserts value is GetUserInfoOutput {
    assertSchema(
      value,
      {
        $defs: {
          UserAccount: {
            properties: {
              account: { title: 'Account', type: 'string' },
              id: { title: 'Id', type: 'string' },
              _name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Name' },
              is_personal: { title: 'Is Personal', type: 'boolean' },
              in_mail: { title: 'In Mail', type: 'boolean' },
              in_calendar: { title: 'In Calendar', type: 'boolean' },
              jmap_account: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Jmap Account',
              },
              default_outgoing_email: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Default Outgoing Email',
              },
              enable_screening: { title: 'Enable Screening', type: 'boolean' },
              block_remote_images: { title: 'Block Remote Images', type: 'boolean' },
              on_block_old_mail: { title: 'On Block Old Mail', type: 'string' },
            },
            required: [
              'account',
              'id',
              '_name',
              'is_personal',
              'in_mail',
              'in_calendar',
              'jmap_account',
              'default_outgoing_email',
              'enable_screening',
              'block_remote_images',
              'on_block_old_mail',
            ],
            title: 'UserAccount',
            type: 'object',
          },
          UserInfo: {
            properties: {
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
              full_name: { title: 'Full Name', type: 'string' },
              first_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'First Name' },
              last_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Last Name' },
              enabled: { enum: [0, 1], title: 'Enabled', type: 'integer' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
              user_type: { title: 'User Type', type: 'string' },
              username: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Username' },
              api_key: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Api Key' },
              time_zone: { title: 'Time Zone', type: 'string' },
              system_time_zone: { title: 'System Time Zone', type: 'string' },
              group_messages_by: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Group Messages By',
              },
              show_reading_pane: { enum: [0, 1], title: 'Show Reading Pane', type: 'integer' },
              undo_send_period: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Undo Send Period',
              },
              user_settings: { title: 'User Settings', type: 'string' },
              is_suite_admin: { title: 'Is Suite Admin', type: 'boolean' },
              is_system_manager: { title: 'Is System Manager', type: 'boolean' },
              is_jmap_configured: { title: 'Is Jmap Configured', type: 'boolean' },
              max_attachment_size: { title: 'Max Attachment Size', type: 'integer' },
              is_suite_cloud_configured: { title: 'Is Suite Cloud Configured', type: 'boolean' },
              accounts: {
                items: { $ref: '#/$defs/UserAccount' },
                title: 'Accounts',
                type: 'array',
              },
            },
            required: [
              'name',
              'email',
              'full_name',
              'first_name',
              'last_name',
              'enabled',
              'user_image',
              'user_type',
              'username',
              'api_key',
              'time_zone',
              'system_time_zone',
              'group_messages_by',
              'show_reading_pane',
              'undo_send_period',
              'user_settings',
              'is_suite_admin',
              'is_system_manager',
              'is_jmap_configured',
              'max_attachment_size',
              'is_suite_cloud_configured',
              'accounts',
            ],
            title: 'UserInfo',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/UserInfo' }, { type: 'null' }],
      },
      'get_user_info output',
    )
  },
}

export const operationGetAllInboxUnreadCount: Validators<
  GetAllInboxUnreadCountInput,
  GetAllInboxUnreadCountOutput
> = {
  validateInput(value: unknown): asserts value is GetAllInboxUnreadCountInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_all_inbox_unread_count input',
    )
  },
  validateOutput(value: unknown): asserts value is GetAllInboxUnreadCountOutput {
    assertSchema(value, { type: 'integer' }, 'get_all_inbox_unread_count output')
  },
}

export const operationGetUnifiedFolders: Validators<
  GetUnifiedFoldersInput,
  GetUnifiedFoldersOutput
> = {
  validateInput(value: unknown): asserts value is GetUnifiedFoldersInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_unified_folders input',
    )
  },
  validateOutput(value: unknown): asserts value is GetUnifiedFoldersOutput {
    assertSchema(
      value,
      {
        $defs: {
          UnifiedFolder: {
            properties: {
              slug: { title: 'Slug', type: 'string' },
              name: { title: 'Name', type: 'string' },
              role: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Role' },
              unread_threads: { title: 'Unread Threads', type: 'integer' },
              accounts: { items: { type: 'string' }, title: 'Accounts', type: 'array' },
              icon: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Icon' },
              color: {
                anyOf: [
                  { enum: ['Blue', 'Green', 'Amber', 'Red', 'Purple'], type: 'string' },
                  { type: 'null' },
                ],
                title: 'Color',
              },
            },
            required: ['slug', 'name', 'role', 'unread_threads', 'accounts', 'icon', 'color'],
            title: 'UnifiedFolder',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/UnifiedFolder' },
        type: 'array',
      },
      'get_unified_folders output',
    )
  },
}

export const operationGetMailboxes: Validators<GetMailboxesInput, GetMailboxesOutput> = {
  validateInput(value: unknown): asserts value is GetMailboxesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { account: { title: 'Account', type: 'string' } },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'get_mailboxes input',
    )
  },
  validateOutput(value: unknown): asserts value is GetMailboxesOutput {
    assertSchema(
      value,
      {
        $defs: {
          AutomationRules: {
            properties: {
              emails_from: { title: 'Emails From', type: 'string' },
              subject_contains: { title: 'Subject Contains', type: 'string' },
              match_if: { enum: ['any', 'all'], title: 'Match If', type: 'string' },
              mark_as_read: { title: 'Mark As Read', type: 'boolean' },
              add_star: { title: 'Add Star', type: 'boolean' },
            },
            required: ['emails_from', 'subject_contains', 'match_if', 'mark_as_read', 'add_star'],
            title: 'AutomationRules',
            type: 'object',
          },
          Mailbox: {
            properties: {
              name: { title: 'Name', type: 'string' },
              id: { title: 'Id', type: 'string' },
              _name: { title: 'Name', type: 'string' },
              role: {
                anyOf: [
                  {
                    enum: ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive', 'important'],
                    type: 'string',
                  },
                  { type: 'null' },
                ],
                title: 'Role',
              },
              total_emails: { title: 'Total Emails', type: 'integer' },
              total_threads: { title: 'Total Threads', type: 'integer' },
              unread_threads: { title: 'Unread Threads', type: 'integer' },
              slug: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Slug' },
              subscribed: { title: 'Subscribed', type: 'boolean' },
              icon: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Icon' },
              color: {
                anyOf: [
                  { enum: ['Blue', 'Green', 'Amber', 'Red', 'Purple'], type: 'string' },
                  { type: 'null' },
                ],
                title: 'Color',
              },
              disable_push_notification: {
                enum: [0, 1],
                title: 'Disable Push Notification',
                type: 'integer',
              },
              automation_rules: { anyOf: [{ $ref: '#/$defs/AutomationRules' }, { type: 'null' }] },
            },
            required: [
              'name',
              'id',
              '_name',
              'role',
              'total_emails',
              'total_threads',
              'unread_threads',
              'slug',
              'subscribed',
            ],
            title: 'Mailbox',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/Mailbox' },
        type: 'array',
      },
      'get_mailboxes output',
    )
  },
}

export const operationGetIdentities: Validators<GetIdentitiesInput, GetIdentitiesOutput> = {
  validateInput(value: unknown): asserts value is GetIdentitiesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { account: { title: 'Account', type: 'string' } },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'get_identities input',
    )
  },
  validateOutput(value: unknown): asserts value is GetIdentitiesOutput {
    assertSchema(
      value,
      {
        $defs: {
          Address: {
            properties: {
              display_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Display Name',
              },
              email: { title: 'Email', type: 'string' },
            },
            required: ['display_name', 'email'],
            title: 'Address',
            type: 'object',
          },
          Identity: {
            properties: {
              name: { title: 'Name', type: 'string' },
              account: { title: 'Account', type: 'string' },
              id: { title: 'Id', type: 'string' },
              _name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
              bcc: { items: { $ref: '#/$defs/Address' }, title: 'Bcc', type: 'array' },
              reply_to: { items: { $ref: '#/$defs/Address' }, title: 'Reply To', type: 'array' },
              html_signature: { title: 'Html Signature', type: 'string' },
              text_signature: { title: 'Text Signature', type: 'string' },
              may_delete: { enum: [0, 1], title: 'May Delete', type: 'integer' },
              owner: { title: 'Owner', type: 'string' },
              modified_by: { title: 'Modified By', type: 'string' },
              creation: { title: 'Creation', type: 'string' },
              modified: { title: 'Modified', type: 'string' },
            },
            required: [
              'name',
              'account',
              'id',
              '_name',
              'email',
              'bcc',
              'reply_to',
              'html_signature',
              'text_signature',
              'may_delete',
              'owner',
              'modified_by',
              'creation',
              'modified',
            ],
            title: 'Identity',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/Identity' },
        type: 'array',
      },
      'get_identities output',
    )
  },
}

export const operationGetParticipantIdentities: Validators<
  GetParticipantIdentitiesInput,
  GetParticipantIdentitiesOutput
> = {
  validateInput(value: unknown): asserts value is GetParticipantIdentitiesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { account: { title: 'Account', type: 'string' } },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'get_participant_identities input',
    )
  },
  validateOutput(value: unknown): asserts value is GetParticipantIdentitiesOutput {
    assertSchema(
      value,
      {
        $defs: {
          ParticipantIdentity: {
            properties: {
              name: { title: 'Name', type: 'string' },
              account: { title: 'Account', type: 'string' },
              id: { title: 'Id', type: 'string' },
              _name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
              default: { enum: [0, 1], type: 'integer', title: 'Default' },
              owner: { title: 'Owner', type: 'string' },
              modified_by: { title: 'Modified By', type: 'string' },
              creation: { title: 'Creation', type: 'string' },
              modified: { title: 'Modified', type: 'string' },
            },
            required: [
              'name',
              'account',
              'id',
              '_name',
              'email',
              'default',
              'owner',
              'modified_by',
              'creation',
              'modified',
            ],
            title: 'ParticipantIdentity',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/ParticipantIdentity' },
        type: 'array',
      },
      'get_participant_identities output',
    )
  },
}

export const operationGetAddressBooks: Validators<GetAddressBooksInput, GetAddressBooksOutput> = {
  validateInput(value: unknown): asserts value is GetAddressBooksInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { account: { title: 'Account', type: 'string' } },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'get_address_books input',
    )
  },
  validateOutput(value: unknown): asserts value is GetAddressBooksOutput {
    assertSchema(
      value,
      {
        $defs: {
          AddressBook: {
            properties: {
              name: { title: 'Name', type: 'string' },
              id: { title: 'Id', type: 'string' },
              _name: { title: 'Name', type: 'string' },
              default: { enum: [0, 1], type: 'integer', title: 'Default' },
            },
            required: ['name', 'id', '_name', 'default'],
            title: 'AddressBook',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/AddressBook' },
        type: 'array',
      },
      'get_address_books output',
    )
  },
}

export const operationGetScreenedAddresses: Validators<
  GetScreenedAddressesInput,
  GetScreenedAddressesOutput
> = {
  validateInput(value: unknown): asserts value is GetScreenedAddressesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { account: { title: 'Account', type: 'string' } },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'get_screened_addresses input',
    )
  },
  validateOutput(value: unknown): asserts value is GetScreenedAddressesOutput {
    assertSchema(
      value,
      {
        $defs: {
          ScreenedAddress: {
            properties: {
              email: { title: 'Email', type: 'string' },
              action: { enum: ['Spam', 'Accepted'], title: 'Action', type: 'string' },
              creation: { title: 'Creation', type: 'string' },
              modified: { title: 'Modified', type: 'string' },
            },
            required: ['email', 'action', 'creation', 'modified'],
            title: 'ScreenedAddress',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/ScreenedAddress' },
        type: 'array',
      },
      'get_screened_addresses output',
    )
  },
}

export const operationGetGlobalScreenedAddresses: Validators<
  GetGlobalScreenedAddressesInput,
  GetGlobalScreenedAddressesOutput
> = {
  validateInput(value: unknown): asserts value is GetGlobalScreenedAddressesInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_global_screened_addresses input',
    )
  },
  validateOutput(value: unknown): asserts value is GetGlobalScreenedAddressesOutput {
    assertSchema(
      value,
      {
        $defs: {
          ScreenedAddress: {
            properties: {
              email: { title: 'Email', type: 'string' },
              action: { enum: ['Spam', 'Accepted'], title: 'Action', type: 'string' },
              creation: { title: 'Creation', type: 'string' },
              modified: { title: 'Modified', type: 'string' },
            },
            required: ['email', 'action', 'creation', 'modified'],
            title: 'ScreenedAddress',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/ScreenedAddress' },
        type: 'array',
      },
      'get_global_screened_addresses output',
    )
  },
}

export const operationGetSieveScripts: Validators<GetSieveScriptsInput, GetSieveScriptsOutput> = {
  validateInput(value: unknown): asserts value is GetSieveScriptsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { account: { title: 'Account', type: 'string' } },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'get_sieve_scripts input',
    )
  },
  validateOutput(value: unknown): asserts value is GetSieveScriptsOutput {
    assertSchema(
      value,
      {
        $defs: {
          SieveScript: {
            properties: {
              name: { title: 'Name', type: 'string' },
              account: { title: 'Account', type: 'string' },
              id: { title: 'Id', type: 'string' },
              _name: { title: 'Name', type: 'string' },
              active: { enum: [0, 1], title: 'Active', type: 'integer' },
              blob_id: { title: 'Blob Id', type: 'string' },
              content: { title: 'Content', type: 'string' },
              read_only: { title: 'Read Only', type: 'boolean' },
              creation: { title: 'Creation', type: 'string' },
              modified: { title: 'Modified', type: 'string' },
            },
            required: [
              'name',
              'account',
              'id',
              '_name',
              'active',
              'blob_id',
              'content',
              'read_only',
              'creation',
              'modified',
            ],
            title: 'SieveScript',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/SieveScript' },
        type: 'array',
      },
      'get_sieve_scripts output',
    )
  },
}

export const operationGetDomains: Validators<GetDomainsInput, GetDomainsOutput> = {
  validateInput(value: unknown): asserts value is GetDomainsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          start: { title: 'Start', type: 'integer' },
          page_length: { title: 'Page Length', type: 'integer' },
          txt: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Txt' },
          status: {
            anyOf: [
              { enum: ['Active', 'Pending Verification', 'Disabled'], type: 'string' },
              { type: 'null' },
            ],
            title: 'Status',
          },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'get_domains input',
    )
  },
  validateOutput(value: unknown): asserts value is GetDomainsOutput {
    assertSchema(
      value,
      {
        $defs: {
          DomainRow: {
            properties: {
              id: { title: 'Id', type: 'string' },
              name: { title: 'Name', type: 'string' },
              description: { title: 'Description', type: 'string' },
              status: {
                enum: ['Active', 'Pending Verification', 'Disabled'],
                title: 'Status',
                type: 'string',
              },
              is_enabled: { title: 'Is Enabled', type: 'boolean' },
              catch_all_address: { title: 'Catch All Address', type: 'string' },
              sub_addressing: { title: 'Sub Addressing', type: 'boolean' },
              allow_relaying: { title: 'Allow Relaying', type: 'boolean' },
              is_verified: { title: 'Is Verified', type: 'boolean' },
              last_verified_at: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Last Verified At',
              },
              created_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created At' },
            },
            required: [
              'id',
              'name',
              'description',
              'status',
              'is_enabled',
              'catch_all_address',
              'sub_addressing',
              'allow_relaying',
              'is_verified',
              'last_verified_at',
              'created_at',
            ],
            title: 'DomainRow',
            type: 'object',
          },
        },
        properties: {
          items: { items: { $ref: '#/$defs/DomainRow' }, title: 'Items', type: 'array' },
          total: { title: 'Total', type: 'integer' },
        },
        required: ['items', 'total'],
        title: 'DomainPage',
        type: 'object',
      },
      'get_domains output',
    )
  },
}

export const operationGetMembers: Validators<GetMembersInput, GetMembersOutput> = {
  validateInput(value: unknown): asserts value is GetMembersInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          start: { title: 'Start', type: 'integer' },
          page_length: { title: 'Page Length', type: 'integer' },
          search: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Search' },
          is_admin: { anyOf: [{ type: 'boolean' }, { type: 'null' }], title: 'Is Admin' },
          is_enabled: { anyOf: [{ type: 'boolean' }, { type: 'null' }], title: 'Is Enabled' },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'get_members input',
    )
  },
  validateOutput(value: unknown): asserts value is GetMembersOutput {
    assertSchema(
      value,
      {
        $defs: {
          MemberRow: {
            properties: {
              name: { title: 'Name', type: 'string' },
              full_name: { title: 'Full Name', type: 'string' },
              user_image: { title: 'User Image', type: 'string' },
              last_active: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Last Active' },
              enabled: { title: 'Enabled', type: 'boolean' },
              account: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Account' },
              is_admin: { title: 'Is Admin', type: 'boolean' },
              quota_gb: { anyOf: [{ type: 'number' }, { type: 'null' }], title: 'Quota Gb' },
              used_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Used Bytes' },
            },
            required: [
              'name',
              'full_name',
              'user_image',
              'last_active',
              'enabled',
              'account',
              'is_admin',
              'quota_gb',
              'used_bytes',
            ],
            title: 'MemberRow',
            type: 'object',
          },
        },
        properties: {
          items: { items: { $ref: '#/$defs/MemberRow' }, title: 'Items', type: 'array' },
          total: { title: 'Total', type: 'integer' },
        },
        required: ['items', 'total'],
        title: 'MemberPage',
        type: 'object',
      },
      'get_members output',
    )
  },
}

export const operationGetAccountRequests: Validators<
  GetAccountRequestsInput,
  GetAccountRequestsOutput
> = {
  validateInput(value: unknown): asserts value is GetAccountRequestsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          start: { title: 'Start', type: 'integer' },
          page_length: { title: 'Page Length', type: 'integer' },
          search: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Search' },
          status: {
            enum: ['All', 'Pending', 'Accepted', 'Expired'],
            title: 'Status',
            type: 'string',
          },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'get_account_requests input',
    )
  },
  validateOutput(value: unknown): asserts value is GetAccountRequestsOutput {
    assertSchema(
      value,
      {
        $defs: {
          InviteRow: {
            properties: {
              name: { title: 'Name', type: 'string' },
              account: { title: 'Account', type: 'string' },
              is_admin: { enum: [0, 1], title: 'Is Admin', type: 'integer' },
              backup_email: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Backup Email',
              },
              invited_by: { title: 'Invited By', type: 'string' },
              is_verified: { enum: [0, 1], title: 'Is Verified', type: 'integer' },
              status: { enum: ['Pending', 'Accepted', 'Expired'], title: 'Status', type: 'string' },
            },
            required: [
              'name',
              'account',
              'is_admin',
              'backup_email',
              'invited_by',
              'is_verified',
              'status',
            ],
            title: 'InviteRow',
            type: 'object',
          },
        },
        properties: {
          items: { items: { $ref: '#/$defs/InviteRow' }, title: 'Items', type: 'array' },
          total: { title: 'Total', type: 'integer' },
        },
        required: ['items', 'total'],
        title: 'InvitePage',
        type: 'object',
      },
      'get_account_requests output',
    )
  },
}

export const operationGetGroups: Validators<GetGroupsInput, GetGroupsOutput> = {
  validateInput(value: unknown): asserts value is GetGroupsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          start: { title: 'Start', type: 'integer' },
          page_length: { title: 'Page Length', type: 'integer' },
          search: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Search' },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'get_groups input',
    )
  },
  validateOutput(value: unknown): asserts value is GetGroupsOutput {
    assertSchema(
      value,
      {
        $defs: {
          GroupRow: {
            properties: {
              id: { title: 'Id', type: 'string' },
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
              description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
              disable_receiving: { title: 'Disable Receiving', type: 'boolean' },
              quota_gb: { title: 'Quota Gb', type: 'number' },
              used_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Used Bytes' },
              created_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created At' },
            },
            required: [
              'id',
              'name',
              'email',
              'description',
              'disable_receiving',
              'quota_gb',
              'used_bytes',
              'created_at',
            ],
            title: 'GroupRow',
            type: 'object',
          },
        },
        properties: {
          items: { items: { $ref: '#/$defs/GroupRow' }, title: 'Items', type: 'array' },
          total: { title: 'Total', type: 'integer' },
        },
        required: ['items', 'total'],
        title: 'GroupPage',
        type: 'object',
      },
      'get_groups output',
    )
  },
}

export const operationGetMailingLists: Validators<GetMailingListsInput, GetMailingListsOutput> = {
  validateInput(value: unknown): asserts value is GetMailingListsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          start: { title: 'Start', type: 'integer' },
          page_length: { title: 'Page Length', type: 'integer' },
          search: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Search' },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'get_mailing_lists input',
    )
  },
  validateOutput(value: unknown): asserts value is GetMailingListsOutput {
    assertSchema(
      value,
      {
        $defs: {
          MailingListRow: {
            properties: {
              id: { title: 'Id', type: 'string' },
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
              description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
              recipient_count: { title: 'Recipient Count', type: 'integer' },
            },
            required: ['id', 'name', 'email', 'description', 'recipient_count'],
            title: 'MailingListRow',
            type: 'object',
          },
        },
        properties: {
          items: { items: { $ref: '#/$defs/MailingListRow' }, title: 'Items', type: 'array' },
          total: { title: 'Total', type: 'integer' },
        },
        required: ['items', 'total'],
        title: 'MailingListPage',
        type: 'object',
      },
      'get_mailing_lists output',
    )
  },
}

export const operationGetMailingListRecipients: Validators<
  GetMailingListRecipientsInput,
  GetMailingListRecipientsOutput
> = {
  validateInput(value: unknown): asserts value is GetMailingListRecipientsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          start: { title: 'Start', type: 'integer' },
          page_length: { title: 'Page Length', type: 'integer' },
          search: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Search' },
          list_id: { title: 'List Id', type: 'string' },
        },
        required: ['list_id'],
        additionalProperties: false,
        $defs: {},
      },
      'get_mailing_list_recipients input',
    )
  },
  validateOutput(value: unknown): asserts value is GetMailingListRecipientsOutput {
    assertSchema(
      value,
      {
        $defs: {
          RecipientRow: {
            properties: {
              email: { title: 'Email', type: 'string' },
              enabled: { title: 'Enabled', type: 'boolean' },
            },
            required: ['email', 'enabled'],
            title: 'RecipientRow',
            type: 'object',
          },
        },
        properties: {
          items: { items: { $ref: '#/$defs/RecipientRow' }, title: 'Items', type: 'array' },
          total: { title: 'Total', type: 'integer' },
        },
        required: ['items', 'total'],
        title: 'RecipientPage',
        type: 'object',
      },
      'get_mailing_list_recipients output',
    )
  },
}

export const operationGetDmarcReports: Validators<GetDmarcReportsInput, GetDmarcReportsOutput> = {
  validateInput(value: unknown): asserts value is GetDmarcReportsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          start: { title: 'Start', type: 'integer' },
          page_length: { title: 'Page Length', type: 'integer' },
          txt: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Txt' },
          domain_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Domain Id' },
          days: { title: 'Days', type: 'integer' },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'get_dmarc_reports input',
    )
  },
  validateOutput(value: unknown): asserts value is GetDmarcReportsOutput {
    assertSchema(
      value,
      {
        $defs: {
          DmarcPolicy: {
            properties: {
              domain: { title: 'Domain', type: 'string' },
              testing_mode: { title: 'Testing Mode', type: 'boolean' },
              adkim: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Adkim' },
              aspf: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Aspf' },
              p: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'P' },
              sp: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Sp' },
              pct: { title: 'Pct', type: 'integer' },
              fo: { title: 'Fo', type: 'string' },
            },
            title: 'DmarcPolicy',
            type: 'object',
          },
          DmarcRow: {
            properties: {
              id: { title: 'Id', type: 'string' },
              domain: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Domain' },
              reporter: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Reporter' },
              reporter_email: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Reporter Email',
              },
              report_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Report Id' },
              subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
              to: { items: { type: 'string' }, title: 'To', type: 'array' },
              date_range_begin: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Date Range Begin',
              },
              date_range_end: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Date Range End',
              },
              received_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Received At' },
              reports: { title: 'Reports', type: 'integer' },
              version: { anyOf: [{ type: 'number' }, { type: 'null' }], title: 'Version' },
              policy: { $ref: '#/$defs/DmarcPolicy' },
              errors: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Errors' },
              pass_rate: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Pass Rate' },
              messages: { title: 'Messages', type: 'integer' },
              passed: { title: 'Passed', type: 'integer' },
              failed: { title: 'Failed', type: 'integer' },
              dkim_passed: { title: 'Dkim Passed', type: 'integer' },
              spf_passed: { title: 'Spf Passed', type: 'integer' },
            },
            required: [
              'id',
              'domain',
              'reporter',
              'reporter_email',
              'report_id',
              'subject',
              'to',
              'date_range_begin',
              'date_range_end',
              'received_at',
              'reports',
              'version',
              'policy',
              'errors',
              'pass_rate',
              'messages',
              'passed',
              'failed',
              'dkim_passed',
              'spf_passed',
            ],
            title: 'DmarcRow',
            type: 'object',
          },
        },
        properties: {
          items: { items: { $ref: '#/$defs/DmarcRow' }, title: 'Items', type: 'array' },
          total: { title: 'Total', type: 'integer' },
        },
        required: ['items', 'total'],
        title: 'DmarcPage',
        type: 'object',
      },
      'get_dmarc_reports output',
    )
  },
}

export const operationGetTlsReports: Validators<GetTlsReportsInput, GetTlsReportsOutput> = {
  validateInput(value: unknown): asserts value is GetTlsReportsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          start: { title: 'Start', type: 'integer' },
          page_length: { title: 'Page Length', type: 'integer' },
          txt: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Txt' },
          domain_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Domain Id' },
          days: { title: 'Days', type: 'integer' },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'get_tls_reports input',
    )
  },
  validateOutput(value: unknown): asserts value is GetTlsReportsOutput {
    assertSchema(
      value,
      {
        $defs: {
          TlsRow: {
            properties: {
              id: { title: 'Id', type: 'string' },
              domain: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Domain' },
              reporter: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Reporter' },
              reporter_email: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Reporter Email',
              },
              report_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Report Id' },
              subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
              to: { items: { type: 'string' }, title: 'To', type: 'array' },
              date_range_begin: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Date Range Begin',
              },
              date_range_end: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Date Range End',
              },
              received_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Received At' },
              reports: { title: 'Reports', type: 'integer' },
              contact_info: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Contact Info',
              },
              policy_types: { items: { type: 'string' }, title: 'Policy Types', type: 'array' },
              successful: { title: 'Successful', type: 'integer' },
              failed: { title: 'Failed', type: 'integer' },
              sessions: { title: 'Sessions', type: 'integer' },
              success_rate: {
                anyOf: [{ type: 'integer' }, { type: 'null' }],
                title: 'Success Rate',
              },
            },
            required: [
              'id',
              'domain',
              'reporter',
              'reporter_email',
              'report_id',
              'subject',
              'to',
              'date_range_begin',
              'date_range_end',
              'received_at',
              'reports',
              'contact_info',
              'policy_types',
              'successful',
              'failed',
              'sessions',
              'success_rate',
            ],
            title: 'TlsRow',
            type: 'object',
          },
        },
        properties: {
          items: { items: { $ref: '#/$defs/TlsRow' }, title: 'Items', type: 'array' },
          total: { title: 'Total', type: 'integer' },
        },
        required: ['items', 'total'],
        title: 'TlsPage',
        type: 'object',
      },
      'get_tls_reports output',
    )
  },
}

export const operationScreenEmailAddresses: Validators<
  ScreenEmailAddressesInput,
  ScreenEmailAddressesOutput
> = {
  validateInput(value: unknown): asserts value is ScreenEmailAddressesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          emails: { items: { type: 'string' }, title: 'Emails', type: 'array' },
          action: { enum: ['Spam', 'Accepted'], title: 'Action', type: 'string' },
          override: { title: 'Override', type: 'boolean' },
        },
        required: ['account', 'emails'],
        additionalProperties: false,
        $defs: {},
      },
      'screen_email_addresses input',
    )
  },
  validateOutput(value: unknown): asserts value is ScreenEmailAddressesOutput {
    assertSchema(value, { type: 'null' }, 'screen_email_addresses output')
  },
}

export const operationUnscreenEmailAddresses: Validators<
  UnscreenEmailAddressesInput,
  UnscreenEmailAddressesOutput
> = {
  validateInput(value: unknown): asserts value is UnscreenEmailAddressesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          emails: { items: { type: 'string' }, title: 'Emails', type: 'array' },
        },
        required: ['account', 'emails'],
        additionalProperties: false,
        $defs: {},
      },
      'unscreen_email_addresses input',
    )
  },
  validateOutput(value: unknown): asserts value is UnscreenEmailAddressesOutput {
    assertSchema(value, { type: 'null' }, 'unscreen_email_addresses output')
  },
}

export const operationGetCalendarClientConfig: Validators<
  GetCalendarClientConfigInput,
  GetCalendarClientConfigOutput
> = {
  validateInput(value: unknown): asserts value is GetCalendarClientConfigInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_calendar_client_config input',
    )
  },
  validateOutput(value: unknown): asserts value is GetCalendarClientConfigOutput {
    assertSchema(
      value,
      {
        properties: {
          server_url: { title: 'Server Url', type: 'string' },
          calendar_url: { title: 'Calendar Url', type: 'string' },
          username: { title: 'Username', type: 'string' },
        },
        title: 'CalendarClientConfig',
        type: 'object',
      },
      'get_calendar_client_config output',
    )
  },
}

export const operationGetEmailSuggestions: Validators<
  GetEmailSuggestionsInput,
  GetEmailSuggestionsOutput
> = {
  validateInput(value: unknown): asserts value is GetEmailSuggestionsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          text: { title: 'Text', type: 'string' },
          limit: { title: 'Limit', type: 'integer' },
        },
        required: ['account', 'text'],
        additionalProperties: false,
        $defs: {},
      },
      'get_email_suggestions input',
    )
  },
  validateOutput(value: unknown): asserts value is GetEmailSuggestionsOutput {
    assertSchema(
      value,
      {
        $defs: {
          EmailSuggestion: {
            properties: {
              name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Name' },
              email: { title: 'Email', type: 'string' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: ['name', 'email'],
            title: 'EmailSuggestion',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/EmailSuggestion' },
        type: 'array',
      },
      'get_email_suggestions output',
    )
  },
}

export const operationCreateCalendarImport: Validators<
  CreateCalendarImportInput,
  CreateCalendarImportOutput
> = {
  validateInput(value: unknown): asserts value is CreateCalendarImportInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          format: { enum: ['ics', 'jmap'], title: 'Format', type: 'string' },
          file: { title: 'File', type: 'string' },
          calendar: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Calendar' },
        },
        required: ['account', 'format', 'file'],
        additionalProperties: false,
        $defs: {},
      },
      'create_calendar_import input',
    )
  },
  validateOutput(value: unknown): asserts value is CreateCalendarImportOutput {
    assertSchema(value, { type: 'null' }, 'create_calendar_import output')
  },
}

export const operationCreateCalendarExport: Validators<
  CreateCalendarExportInput,
  CreateCalendarExportOutput
> = {
  validateInput(value: unknown): asserts value is CreateCalendarExportInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          format: { enum: ['ics', 'jmap'], title: 'Format', type: 'string' },
          archive_type: {
            enum: ['.zip', '.tgz', '.tar.gz'],
            title: 'Archive Type',
            type: 'string',
          },
          sort: { enum: ['Start (ASC)', 'Start (DESC)'], title: 'Sort', type: 'string' },
          limit: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Limit' },
          filter: { anyOf: [{ $ref: '#/$defs/CalendarExportFilter' }, { type: 'null' }] },
        },
        required: ['account', 'format', 'archive_type', 'sort'],
        additionalProperties: false,
        $defs: {
          CalendarExportFilter: {
            properties: {
              title: { title: 'Title', type: 'string' },
              inCalendar: { title: 'Incalendar', type: 'string' },
              after: { title: 'After', type: 'string' },
              before: { title: 'Before', type: 'string' },
            },
            title: 'CalendarExportFilter',
            type: 'object',
          },
        },
      },
      'create_calendar_export input',
    )
  },
  validateOutput(value: unknown): asserts value is CreateCalendarExportOutput {
    assertSchema(value, { type: 'null' }, 'create_calendar_export output')
  },
}

export const operationOngoingCalendarExchange: Validators<
  OngoingCalendarExchangeInput,
  OngoingCalendarExchangeOutput
> = {
  validateInput(value: unknown): asserts value is OngoingCalendarExchangeInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          doctype: { const: 'Calendar Exchange', title: 'Doctype', type: 'string' },
          fieldname: { const: 'name', title: 'Fieldname', type: 'string' },
          filters: { $ref: '#/$defs/ExchangeFilters' },
        },
        required: ['doctype', 'fieldname', 'filters'],
        additionalProperties: false,
        $defs: {
          ExchangeFilters: {
            properties: {
              user: { title: 'User', type: 'string' },
              account: { title: 'Account', type: 'string' },
              operation: { enum: ['Import', 'Export'], title: 'Operation', type: 'string' },
              status: {
                maxItems: 2,
                minItems: 2,
                prefixItems: [
                  { const: 'in', type: 'string' },
                  { items: { enum: ['Queued', 'In Progress'], type: 'string' }, type: 'array' },
                ],
                title: 'Status',
                type: 'array',
              },
            },
            required: ['user', 'operation', 'status'],
            title: 'ExchangeFilters',
            type: 'object',
          },
        },
      },
      'ongoing_calendar_exchange input',
    )
  },
  validateOutput(value: unknown): asserts value is OngoingCalendarExchangeOutput {
    assertSchema(
      value,
      {
        $defs: {
          ExchangeName: {
            properties: { name: { title: 'Name', type: 'string' } },
            title: 'ExchangeName',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/ExchangeName' }, { type: 'null' }],
      },
      'ongoing_calendar_exchange output',
    )
  },
}

export const operationAddParticipantIdentity: Validators<
  AddParticipantIdentityInput,
  AddParticipantIdentityOutput
> = {
  validateInput(value: unknown): asserts value is AddParticipantIdentityInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          name: { title: 'Name', type: 'string' },
          email: { title: 'Email', type: 'string' },
          default: { type: 'boolean', title: 'Default' },
        },
        required: ['account', 'name', 'email'],
        additionalProperties: false,
        $defs: {},
      },
      'add_participant_identity input',
    )
  },
  validateOutput(value: unknown): asserts value is AddParticipantIdentityOutput {
    assertSchema(value, { type: 'string' }, 'add_participant_identity output')
  },
}

export const operationUpdateParticipantIdentity: Validators<
  UpdateParticipantIdentityInput,
  UpdateParticipantIdentityOutput
> = {
  validateInput(value: unknown): asserts value is UpdateParticipantIdentityInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          name: { title: 'Name', type: 'string' },
          email: { title: 'Email', type: 'string' },
          default: { type: 'boolean', title: 'Default' },
          id: { title: 'Id', type: 'string' },
        },
        required: ['account', 'name', 'email', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'update_participant_identity input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateParticipantIdentityOutput {
    assertSchema(value, { type: 'null' }, 'update_participant_identity output')
  },
}

export const operationDeleteParticipantIdentities: Validators<
  DeleteParticipantIdentitiesInput,
  DeleteParticipantIdentitiesOutput
> = {
  validateInput(value: unknown): asserts value is DeleteParticipantIdentitiesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { names: { items: { type: 'string' }, title: 'Names', type: 'array' } },
        required: ['names'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_participant_identities input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteParticipantIdentitiesOutput {
    assertSchema(value, { type: 'null' }, 'delete_participant_identities output')
  },
}

export const operationGetBranding: Validators<GetBrandingInput, GetBrandingOutput> = {
  validateInput(value: unknown): asserts value is GetBrandingInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_branding input',
    )
  },
  validateOutput(value: unknown): asserts value is GetBrandingOutput {
    assertSchema(
      value,
      {
        properties: {
          brand_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Brand Name' },
          brand_html: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Brand Html' },
          favicon: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Favicon' },
        },
        required: ['brand_name', 'brand_html', 'favicon'],
        title: 'Branding',
        type: 'object',
      },
      'get_branding output',
    )
  },
}

export const operationGetSignupSettings: Validators<
  GetSignupSettingsInput,
  GetSignupSettingsOutput
> = {
  validateInput(value: unknown): asserts value is GetSignupSettingsInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_signup_settings input',
    )
  },
  validateOutput(value: unknown): asserts value is GetSignupSettingsOutput {
    assertSchema(
      value,
      {
        properties: { allow_signup: { enum: [0, 1], title: 'Allow Signup', type: 'integer' } },
        required: ['allow_signup'],
        title: 'SignupSettings',
        type: 'object',
      },
      'get_signup_settings output',
    )
  },
}

export const operationGetSignupDomains: Validators<GetSignupDomainsInput, GetSignupDomainsOutput> =
  {
    validateInput(value: unknown): asserts value is GetSignupDomainsInput {
      assertSchema(
        value,
        { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
        'get_signup_domains input',
      )
    },
    validateOutput(value: unknown): asserts value is GetSignupDomainsOutput {
      assertSchema(value, { items: { type: 'string' }, type: 'array' }, 'get_signup_domains output')
    },
  }

export const operationValidateEmailAssigned: Validators<
  ValidateEmailAssignedInput,
  ValidateEmailAssignedOutput
> = {
  validateInput(value: unknown): asserts value is ValidateEmailAssignedInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { email: { title: 'Email', type: 'string' } },
        required: ['email'],
        additionalProperties: false,
        $defs: {},
      },
      'validate_email_assigned input',
    )
  },
  validateOutput(value: unknown): asserts value is ValidateEmailAssignedOutput {
    assertSchema(value, { type: 'null' }, 'validate_email_assigned output')
  },
}

export const operationSignup: Validators<SignupInput, SignupOutput> = {
  validateInput(value: unknown): asserts value is SignupInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          username: { title: 'Username', type: 'string' },
          domain: { title: 'Domain', type: 'string' },
          email: { title: 'Email', type: 'string' },
        },
        required: ['username', 'domain', 'email'],
        additionalProperties: false,
        $defs: {},
      },
      'signup input',
    )
  },
  validateOutput(value: unknown): asserts value is SignupOutput {
    assertSchema(value, { type: 'string' }, 'signup output')
  },
}

export const operationResendOtp: Validators<ResendOtpInput, ResendOtpOutput> = {
  validateInput(value: unknown): asserts value is ResendOtpInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { account_request: { title: 'Account Request', type: 'string' } },
        required: ['account_request'],
        additionalProperties: false,
        $defs: {},
      },
      'resend_otp input',
    )
  },
  validateOutput(value: unknown): asserts value is ResendOtpOutput {
    assertSchema(value, { type: 'null' }, 'resend_otp output')
  },
}

export const operationVerifyOtp: Validators<VerifyOtpInput, VerifyOtpOutput> = {
  validateInput(value: unknown): asserts value is VerifyOtpInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account_request: { title: 'Account Request', type: 'string' },
          otp: { title: 'Otp', type: 'string' },
        },
        required: ['account_request', 'otp'],
        additionalProperties: false,
        $defs: {},
      },
      'verify_otp input',
    )
  },
  validateOutput(value: unknown): asserts value is VerifyOtpOutput {
    assertSchema(value, { type: 'string' }, 'verify_otp output')
  },
}

export const operationGetAccountRequest: Validators<
  GetAccountRequestInput,
  GetAccountRequestOutput
> = {
  validateInput(value: unknown): asserts value is GetAccountRequestInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { request_key: { title: 'Request Key', type: 'string' } },
        required: ['request_key'],
        additionalProperties: false,
        $defs: {},
      },
      'get_account_request input',
    )
  },
  validateOutput(value: unknown): asserts value is GetAccountRequestOutput {
    assertSchema(
      value,
      {
        $defs: {
          AccountRequest: {
            properties: {
              backup_email: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Backup Email',
              },
              account: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Account' },
              is_verified: { enum: [0, 1], title: 'Is Verified', type: 'integer' },
              is_expired: { enum: [0, 1], title: 'Is Expired', type: 'integer' },
            },
            required: ['backup_email', 'account', 'is_verified', 'is_expired'],
            title: 'AccountRequest',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/AccountRequest' }, { type: 'null' }],
      },
      'get_account_request output',
    )
  },
}

export const operationGetAccountSetupOptions: Validators<
  GetAccountSetupOptionsInput,
  GetAccountSetupOptionsOutput
> = {
  validateInput(value: unknown): asserts value is GetAccountSetupOptionsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { request_key: { title: 'Request Key', type: 'string' } },
        required: ['request_key'],
        additionalProperties: false,
        $defs: {},
      },
      'get_account_setup_options input',
    )
  },
  validateOutput(value: unknown): asserts value is GetAccountSetupOptionsOutput {
    assertSchema(
      value,
      {
        $defs: {
          Option: {
            properties: {
              value: { title: 'Value', type: 'string' },
              label: { title: 'Label', type: 'string' },
            },
            required: ['value', 'label'],
            title: 'Option',
            type: 'object',
          },
        },
        properties: {
          locales: { items: { $ref: '#/$defs/Option' }, title: 'Locales', type: 'array' },
          time_zones: { items: { $ref: '#/$defs/Option' }, title: 'Time Zones', type: 'array' },
        },
        required: ['locales', 'time_zones'],
        title: 'AccountOptions',
        type: 'object',
      },
      'get_account_setup_options output',
    )
  },
}

export const operationCreateAccount: Validators<CreateAccountInput, CreateAccountOutput> = {
  validateInput(value: unknown): asserts value is CreateAccountInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          request_key: { title: 'Request Key', type: 'string' },
          first_name: { title: 'First Name', type: 'string' },
          last_name: { title: 'Last Name', type: 'string' },
          password: { title: 'Password', type: 'string' },
          locale: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Locale' },
          time_zone: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Time Zone' },
        },
        required: ['request_key', 'first_name', 'last_name', 'password'],
        additionalProperties: false,
        $defs: {},
      },
      'create_account input',
    )
  },
  validateOutput(value: unknown): asserts value is CreateAccountOutput {
    assertSchema(value, { type: 'null' }, 'create_account output')
  },
}

export const operationSendResetPasswordLink: Validators<
  SendResetPasswordLinkInput,
  SendResetPasswordLinkOutput
> = {
  validateInput(value: unknown): asserts value is SendResetPasswordLinkInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { user: { title: 'User', type: 'string' } },
        required: ['user'],
        additionalProperties: false,
        $defs: {},
      },
      'send_reset_password_link input',
    )
  },
  validateOutput(value: unknown): asserts value is SendResetPasswordLinkOutput {
    assertSchema(value, { type: 'string' }, 'send_reset_password_link output')
  },
}

export const operationGetUserForResetPasswordKey: Validators<
  GetUserForResetPasswordKeyInput,
  GetUserForResetPasswordKeyOutput
> = {
  validateInput(value: unknown): asserts value is GetUserForResetPasswordKeyInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { key: { title: 'Key', type: 'string' } },
        required: ['key'],
        additionalProperties: false,
        $defs: {},
      },
      'get_user_for_reset_password_key input',
    )
  },
  validateOutput(value: unknown): asserts value is GetUserForResetPasswordKeyOutput {
    assertSchema(
      value,
      { anyOf: [{ type: 'string' }, { type: 'null' }] },
      'get_user_for_reset_password_key output',
    )
  },
}

export const operationFetchAttachment: Validators<FetchAttachmentInput, FetchAttachmentOutput> = {
  validateInput(value: unknown): asserts value is FetchAttachmentInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          blob_id: { title: 'Blob Id', type: 'string' },
        },
        required: ['account', 'blob_id'],
        additionalProperties: false,
        $defs: {},
      },
      'fetch_attachment input',
    )
  },
  validateOutput(value: unknown): asserts value is FetchAttachmentOutput {
    if (!(value instanceof Blob)) throw new TypeError('Expected Blob')
  },
}

export const operationFetchAttachmentsAsZip: Validators<
  FetchAttachmentsAsZipInput,
  FetchAttachmentsAsZipOutput
> = {
  validateInput(value: unknown): asserts value is FetchAttachmentsAsZipInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          attachments: {
            items: { $ref: '#/$defs/ZipAttachment' },
            title: 'Attachments',
            type: 'array',
          },
        },
        required: ['account', 'attachments'],
        additionalProperties: false,
        $defs: {
          ZipAttachment: {
            properties: {
              blob_id: { title: 'Blob Id', type: 'string' },
              filename: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Filename' },
            },
            required: ['blob_id'],
            title: 'ZipAttachment',
            type: 'object',
          },
        },
      },
      'fetch_attachments_as_zip input',
    )
  },
  validateOutput(value: unknown): asserts value is FetchAttachmentsAsZipOutput {
    if (!(value instanceof Blob)) throw new TypeError('Expected Blob')
  },
}

export const operationGetMailClientConfig: Validators<
  GetMailClientConfigInput,
  GetMailClientConfigOutput
> = {
  validateInput(value: unknown): asserts value is GetMailClientConfigInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_mail_client_config input',
    )
  },
  validateOutput(value: unknown): asserts value is GetMailClientConfigOutput {
    assertSchema(
      value,
      {
        $defs: {
          MailClientConfig: {
            properties: {
              protocol: { title: 'Protocol', type: 'string' },
              hostname: { title: 'Hostname', type: 'string' },
              port: { title: 'Port', type: 'integer' },
              connection_security: { title: 'Connection Security', type: 'string' },
            },
            required: ['protocol', 'hostname', 'port', 'connection_security'],
            title: 'MailClientConfig',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/MailClientConfig' },
        type: 'array',
      },
      'get_mail_client_config output',
    )
  },
}

export const operationGetQuota: Validators<GetQuotaInput, GetQuotaOutput> = {
  validateInput(value: unknown): asserts value is GetQuotaInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { account: { title: 'Account', type: 'string' } },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'get_quota input',
    )
  },
  validateOutput(value: unknown): asserts value is GetQuotaOutput {
    assertSchema(
      value,
      {
        properties: {
          disk_quota: { title: 'Disk Quota', type: 'integer' },
          used_quota: { title: 'Used Quota', type: 'integer' },
          used_percentage: { title: 'Used Percentage', type: 'number' },
        },
        required: ['disk_quota', 'used_quota', 'used_percentage'],
        title: 'Quota',
        type: 'object',
      },
      'get_quota output',
    )
  },
}

export const operationSetSignature: Validators<SetSignatureInput, SetSignatureOutput> = {
  validateInput(value: unknown): asserts value is SetSignatureInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          identity: { title: 'Identity', type: 'string' },
          signature: { title: 'Signature', type: 'string' },
        },
        required: ['identity', 'signature'],
        additionalProperties: false,
        $defs: {},
      },
      'set_signature input',
    )
  },
  validateOutput(value: unknown): asserts value is SetSignatureOutput {
    assertSchema(value, { type: 'null' }, 'set_signature output')
  },
}

export const operationCreateMailbox: Validators<CreateMailboxInput, CreateMailboxOutput> = {
  validateInput(value: unknown): asserts value is CreateMailboxInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          name: { title: 'Name', type: 'string' },
          parent: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Parent' },
          icon: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Icon' },
          color: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Color' },
          disable_push_notification: { title: 'Disable Push Notification', type: 'boolean' },
          automation_rules: { anyOf: [{ $ref: '#/$defs/AutomationRules' }, { type: 'null' }] },
        },
        required: ['account', 'name'],
        additionalProperties: false,
        $defs: {
          AutomationRules: {
            properties: {
              emails_from: { title: 'Emails From', type: 'string' },
              subject_contains: { title: 'Subject Contains', type: 'string' },
              match_if: { enum: ['any', 'all'], title: 'Match If', type: 'string' },
              mark_as_read: {
                anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
                title: 'Mark As Read',
              },
              add_star: {
                anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
                title: 'Add Star',
              },
            },
            required: ['emails_from', 'subject_contains', 'match_if', 'mark_as_read', 'add_star'],
            title: 'AutomationRules',
            type: 'object',
          },
        },
      },
      'create_mailbox input',
    )
  },
  validateOutput(value: unknown): asserts value is CreateMailboxOutput {
    assertSchema(value, { type: 'string' }, 'create_mailbox output')
  },
}

export const operationUpdateMailbox: Validators<UpdateMailboxInput, UpdateMailboxOutput> = {
  validateInput(value: unknown): asserts value is UpdateMailboxInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          name: { title: 'Name', type: 'string' },
          parent: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Parent' },
          icon: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Icon' },
          color: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Color' },
          disable_push_notification: { title: 'Disable Push Notification', type: 'boolean' },
          automation_rules: { anyOf: [{ $ref: '#/$defs/AutomationRules' }, { type: 'null' }] },
          id: { title: 'Id', type: 'string' },
          old_name: { title: 'Old Name', type: 'string' },
          role: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Role' },
        },
        required: ['account', 'name', 'id', 'old_name'],
        additionalProperties: false,
        $defs: {
          AutomationRules: {
            properties: {
              emails_from: { title: 'Emails From', type: 'string' },
              subject_contains: { title: 'Subject Contains', type: 'string' },
              match_if: { enum: ['any', 'all'], title: 'Match If', type: 'string' },
              mark_as_read: {
                anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
                title: 'Mark As Read',
              },
              add_star: {
                anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
                title: 'Add Star',
              },
            },
            required: ['emails_from', 'subject_contains', 'match_if', 'mark_as_read', 'add_star'],
            title: 'AutomationRules',
            type: 'object',
          },
        },
      },
      'update_mailbox input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateMailboxOutput {
    assertSchema(value, { type: 'null' }, 'update_mailbox output')
  },
}

export const operationDeleteMailbox: Validators<DeleteMailboxInput, DeleteMailboxOutput> = {
  validateInput(value: unknown): asserts value is DeleteMailboxInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
          name: { title: 'Name', type: 'string' },
        },
        required: ['account', 'id', 'name'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_mailbox input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteMailboxOutput {
    assertSchema(value, { type: 'null' }, 'delete_mailbox output')
  },
}

export const operationScreenEmailAddress: Validators<
  ScreenEmailAddressInput,
  ScreenEmailAddressOutput
> = {
  validateInput(value: unknown): asserts value is ScreenEmailAddressInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          email: { title: 'Email', type: 'string' },
          action: { enum: ['Spam', 'Accepted'], title: 'Action', type: 'string' },
        },
        required: ['account', 'email'],
        additionalProperties: false,
        $defs: {},
      },
      'screen_email_address input',
    )
  },
  validateOutput(value: unknown): asserts value is ScreenEmailAddressOutput {
    assertSchema(value, { type: 'null' }, 'screen_email_address output')
  },
}

export const operationCreateSieveScript: Validators<
  CreateSieveScriptInput,
  CreateSieveScriptOutput
> = {
  validateInput(value: unknown): asserts value is CreateSieveScriptInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          _name: { title: 'Name', type: 'string' },
          content: { title: 'Content', type: 'string' },
          active: { title: 'Active', type: 'boolean' },
        },
        required: ['account', '_name', 'content', 'active'],
        additionalProperties: false,
        $defs: {},
      },
      'create_sieve_script input',
    )
  },
  validateOutput(value: unknown): asserts value is CreateSieveScriptOutput {
    assertSchema(value, { type: 'null' }, 'create_sieve_script output')
  },
}

export const operationUpdateSieveScript: Validators<
  UpdateSieveScriptInput,
  UpdateSieveScriptOutput
> = {
  validateInput(value: unknown): asserts value is UpdateSieveScriptInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          _name: { title: 'Name', type: 'string' },
          content: { title: 'Content', type: 'string' },
          active: { title: 'Active', type: 'boolean' },
          id: { title: 'Id', type: 'string' },
        },
        required: ['account', '_name', 'content', 'active', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'update_sieve_script input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateSieveScriptOutput {
    assertSchema(value, { type: 'null' }, 'update_sieve_script output')
  },
}

export const operationDeleteSieveScript: Validators<
  DeleteSieveScriptInput,
  DeleteSieveScriptOutput
> = {
  validateInput(value: unknown): asserts value is DeleteSieveScriptInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
        },
        required: ['account', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_sieve_script input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteSieveScriptOutput {
    assertSchema(value, { type: 'null' }, 'delete_sieve_script output')
  },
}

export const operationCreateAutomationScript: Validators<
  CreateAutomationScriptInput,
  CreateAutomationScriptOutput
> = {
  validateInput(value: unknown): asserts value is CreateAutomationScriptInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          active: { title: 'Active', type: 'boolean' },
        },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'create_automation_script input',
    )
  },
  validateOutput(value: unknown): asserts value is CreateAutomationScriptOutput {
    assertSchema(value, { type: 'null' }, 'create_automation_script output')
  },
}

export const operationRebuildAutomationScriptForAccount: Validators<
  RebuildAutomationScriptForAccountInput,
  RebuildAutomationScriptForAccountOutput
> = {
  validateInput(value: unknown): asserts value is RebuildAutomationScriptForAccountInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { account: { title: 'Account', type: 'string' } },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'rebuild_automation_script_for_account input',
    )
  },
  validateOutput(value: unknown): asserts value is RebuildAutomationScriptForAccountOutput {
    assertSchema(value, { type: 'null' }, 'rebuild_automation_script_for_account output')
  },
}

export const operationGetVacationResponse: Validators<
  GetVacationResponseInput,
  GetVacationResponseOutput
> = {
  validateInput(value: unknown): asserts value is GetVacationResponseInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { account: { title: 'Account', type: 'string' } },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'get_vacation_response input',
    )
  },
  validateOutput(value: unknown): asserts value is GetVacationResponseOutput {
    assertSchema(
      value,
      {
        properties: {
          account: { title: 'Account', type: 'string' },
          enabled: {
            anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
            title: 'Enabled',
          },
          from_date: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Date' },
          to_date: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'To Date' },
          subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
          text_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Text Body' },
          html_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Html Body' },
          creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
          modified: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Modified' },
        },
        required: [
          'account',
          'enabled',
          'from_date',
          'to_date',
          'subject',
          'text_body',
          'html_body',
          'creation',
          'modified',
        ],
        title: 'Vacation',
        type: 'object',
      },
      'get_vacation_response output',
    )
  },
}

export const operationUpdateVacationResponse: Validators<
  UpdateVacationResponseInput,
  UpdateVacationResponseOutput
> = {
  validateInput(value: unknown): asserts value is UpdateVacationResponseInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          enabled: {
            anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
            title: 'Enabled',
          },
          from_date: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Date' },
          to_date: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'To Date' },
          subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
          text_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Text Body' },
          html_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Html Body' },
        },
        required: ['account', 'enabled'],
        additionalProperties: false,
        $defs: {},
      },
      'update_vacation_response input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateVacationResponseOutput {
    assertSchema(value, { type: 'null' }, 'update_vacation_response output')
  },
}

export const operationCreateMailImport: Validators<CreateMailImportInput, CreateMailImportOutput> =
  {
    validateInput(value: unknown): asserts value is CreateMailImportInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: {
            account: { title: 'Account', type: 'string' },
            format: {
              enum: ['eml', 'jmap', 'mbox', 'maildir', 'maildir-nested'],
              title: 'Format',
              type: 'string',
            },
            file: { title: 'File', type: 'string' },
            mailbox: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Mailbox' },
            seen: { title: 'Seen', type: 'boolean' },
          },
          required: ['account', 'format', 'file'],
          additionalProperties: false,
          $defs: {},
        },
        'create_mail_import input',
      )
    },
    validateOutput(value: unknown): asserts value is CreateMailImportOutput {
      assertSchema(value, { type: 'null' }, 'create_mail_import output')
    },
  }

export const operationCreateMailExport: Validators<CreateMailExportInput, CreateMailExportOutput> =
  {
    validateInput(value: unknown): asserts value is CreateMailExportInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: {
            account: { title: 'Account', type: 'string' },
            format: {
              enum: ['jmap', 'mbox', 'maildir', 'maildir-nested'],
              title: 'Format',
              type: 'string',
            },
            archive_type: {
              enum: ['.zip', '.tgz', '.tar.gz'],
              title: 'Archive Type',
              type: 'string',
            },
            sort: {
              enum: ['Received At (ASC)', 'Received At (DESC)'],
              title: 'Sort',
              type: 'string',
            },
            limit: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Limit' },
            filter: { anyOf: [{ $ref: '#/$defs/MailFilter' }, { type: 'null' }] },
          },
          required: ['account', 'format', 'archive_type', 'sort'],
          additionalProperties: false,
          $defs: {
            MailFilter: {
              properties: {
                inMailbox: { title: 'Inmailbox', type: 'string' },
                after: { title: 'After', type: 'string' },
                before: { title: 'Before', type: 'string' },
                hasAttachment: {
                  anyOf: [{ type: 'string' }, { type: 'boolean' }],
                  title: 'Hasattachment',
                },
                isRead: { anyOf: [{ type: 'string' }, { type: 'boolean' }], title: 'Isread' },
              },
              title: 'MailFilter',
              type: 'object',
            },
          },
        },
        'create_mail_export input',
      )
    },
    validateOutput(value: unknown): asserts value is CreateMailExportOutput {
      assertSchema(value, { type: 'null' }, 'create_mail_export output')
    },
  }

export const operationCreateContactsImport: Validators<
  CreateContactsImportInput,
  CreateContactsImportOutput
> = {
  validateInput(value: unknown): asserts value is CreateContactsImportInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          format: { enum: ['vcf', 'jmap'], title: 'Format', type: 'string' },
          file: { title: 'File', type: 'string' },
          address_book: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Address Book' },
        },
        required: ['account', 'format', 'file'],
        additionalProperties: false,
        $defs: {},
      },
      'create_contacts_import input',
    )
  },
  validateOutput(value: unknown): asserts value is CreateContactsImportOutput {
    assertSchema(value, { type: 'null' }, 'create_contacts_import output')
  },
}

export const operationCreateContactsExport: Validators<
  CreateContactsExportInput,
  CreateContactsExportOutput
> = {
  validateInput(value: unknown): asserts value is CreateContactsExportInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          format: { enum: ['jmap', 'vcf'], title: 'Format', type: 'string' },
          archive_type: {
            enum: ['.zip', '.tgz', '.tar.gz'],
            title: 'Archive Type',
            type: 'string',
          },
          limit: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Limit' },
          filter: { anyOf: [{ $ref: '#/$defs/ContactsFilter' }, { type: 'null' }] },
        },
        required: ['account', 'format', 'archive_type'],
        additionalProperties: false,
        $defs: {
          ContactsFilter: {
            properties: {
              inAddressBook: { title: 'Inaddressbook', type: 'string' },
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
            },
            title: 'ContactsFilter',
            type: 'object',
          },
        },
      },
      'create_contacts_export input',
    )
  },
  validateOutput(value: unknown): asserts value is CreateContactsExportOutput {
    assertSchema(value, { type: 'null' }, 'create_contacts_export output')
  },
}

export const operationOngoingExchange: Validators<OngoingExchangeInput, OngoingExchangeOutput> = {
  validateInput(value: unknown): asserts value is OngoingExchangeInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          doctype: {
            enum: ['Mail Exchange', 'Contacts Exchange', 'Calendar Exchange'],
            title: 'Doctype',
            type: 'string',
          },
          fieldname: { const: 'name', title: 'Fieldname', type: 'string' },
          filters: { $ref: '#/$defs/ExchangeFilters' },
        },
        required: ['doctype', 'fieldname', 'filters'],
        additionalProperties: false,
        $defs: {
          ExchangeFilters: {
            properties: {
              user: { title: 'User', type: 'string' },
              account: { title: 'Account', type: 'string' },
              operation: { enum: ['Import', 'Export'], title: 'Operation', type: 'string' },
              status: {
                maxItems: 2,
                minItems: 2,
                prefixItems: [
                  { const: 'in', type: 'string' },
                  { items: { enum: ['Queued', 'In Progress'], type: 'string' }, type: 'array' },
                ],
                title: 'Status',
                type: 'array',
              },
            },
            required: ['user', 'operation', 'status'],
            title: 'ExchangeFilters',
            type: 'object',
          },
        },
      },
      'ongoing_exchange input',
    )
  },
  validateOutput(value: unknown): asserts value is OngoingExchangeOutput {
    assertSchema(
      value,
      {
        $defs: {
          ExchangeName: {
            properties: { name: { title: 'Name', type: 'string' } },
            title: 'ExchangeName',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/ExchangeName' }, { type: 'null' }],
      },
      'ongoing_exchange output',
    )
  },
}

export const operationAddDomain: Validators<AddDomainInput, AddDomainOutput> = {
  validateInput(value: unknown): asserts value is AddDomainInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
        },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'add_domain input',
    )
  },
  validateOutput(value: unknown): asserts value is AddDomainOutput {
    assertSchema(value, { type: 'string' }, 'add_domain output')
  },
}

export const operationAddGroup: Validators<AddGroupInput, AddGroupOutput> = {
  validateInput(value: unknown): asserts value is AddGroupInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          domain: { title: 'Domain', type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
          members: {
            anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'null' }],
            title: 'Members',
          },
          quota_gb: { anyOf: [{ type: 'number' }, { type: 'null' }], title: 'Quota Gb' },
          disable_receiving: { title: 'Disable Receiving', type: 'boolean' },
        },
        required: ['name', 'domain'],
        additionalProperties: false,
        $defs: {},
      },
      'add_group input',
    )
  },
  validateOutput(value: unknown): asserts value is AddGroupOutput {
    assertSchema(value, { type: 'string' }, 'add_group output')
  },
}

export const operationAddGroupEmail: Validators<AddGroupEmailInput, AddGroupEmailOutput> = {
  validateInput(value: unknown): asserts value is AddGroupEmailInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          group_id: { title: 'Group Id', type: 'string' },
          email: { title: 'Email', type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
        },
        required: ['group_id', 'email'],
        additionalProperties: false,
        $defs: {},
      },
      'add_group_email input',
    )
  },
  validateOutput(value: unknown): asserts value is AddGroupEmailOutput {
    assertSchema(value, { type: 'null' }, 'add_group_email output')
  },
}

export const operationAddGroupMembers: Validators<AddGroupMembersInput, AddGroupMembersOutput> = {
  validateInput(value: unknown): asserts value is AddGroupMembersInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          group_id: { title: 'Group Id', type: 'string' },
          account_ids: { items: { type: 'string' }, title: 'Account Ids', type: 'array' },
        },
        required: ['group_id', 'account_ids'],
        additionalProperties: false,
        $defs: {},
      },
      'add_group_members input',
    )
  },
  validateOutput(value: unknown): asserts value is AddGroupMembersOutput {
    assertSchema(value, { type: 'null' }, 'add_group_members output')
  },
}

export const operationAddMailingList: Validators<AddMailingListInput, AddMailingListOutput> = {
  validateInput(value: unknown): asserts value is AddMailingListInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          domain: { title: 'Domain', type: 'string' },
          recipients: {
            anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'null' }],
            title: 'Recipients',
          },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
        },
        required: ['name', 'domain'],
        additionalProperties: false,
        $defs: {},
      },
      'add_mailing_list input',
    )
  },
  validateOutput(value: unknown): asserts value is AddMailingListOutput {
    assertSchema(value, { type: 'string' }, 'add_mailing_list output')
  },
}

export const operationAddMailingListEmail: Validators<
  AddMailingListEmailInput,
  AddMailingListEmailOutput
> = {
  validateInput(value: unknown): asserts value is AddMailingListEmailInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          list_id: { title: 'List Id', type: 'string' },
          email: { title: 'Email', type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
        },
        required: ['list_id', 'email'],
        additionalProperties: false,
        $defs: {},
      },
      'add_mailing_list_email input',
    )
  },
  validateOutput(value: unknown): asserts value is AddMailingListEmailOutput {
    assertSchema(value, { type: 'null' }, 'add_mailing_list_email output')
  },
}

export const operationAddMailingListRecipients: Validators<
  AddMailingListRecipientsInput,
  AddMailingListRecipientsOutput
> = {
  validateInput(value: unknown): asserts value is AddMailingListRecipientsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          list_id: { title: 'List Id', type: 'string' },
          recipients: { items: { type: 'string' }, title: 'Recipients', type: 'array' },
        },
        required: ['list_id', 'recipients'],
        additionalProperties: false,
        $defs: {},
      },
      'add_mailing_list_recipients input',
    )
  },
  validateOutput(value: unknown): asserts value is AddMailingListRecipientsOutput {
    assertSchema(value, { type: 'null' }, 'add_mailing_list_recipients output')
  },
}

export const operationAddMember: Validators<AddMemberInput, AddMemberOutput> = {
  validateInput(value: unknown): asserts value is AddMemberInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          username: { title: 'Username', type: 'string' },
          domain: { title: 'Domain', type: 'string' },
          is_admin: { title: 'Is Admin', type: 'boolean' },
          send_invite: { title: 'Send Invite', type: 'boolean' },
          backup_email: { title: 'Backup Email', type: 'string' },
          first_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'First Name' },
          last_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Last Name' },
          password: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Password' },
          expires_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires At' },
          aliases: {
            anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'null' }],
            title: 'Aliases',
          },
          groups: {
            anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'null' }],
            title: 'Groups',
          },
          mailing_lists: {
            anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'null' }],
            title: 'Mailing Lists',
          },
          quota_gb: { anyOf: [{ type: 'number' }, { type: 'null' }], title: 'Quota Gb' },
          locale: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Locale' },
          time_zone: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Time Zone' },
          disable_receiving: { title: 'Disable Receiving', type: 'boolean' },
        },
        required: ['username', 'domain', 'is_admin', 'send_invite', 'backup_email'],
        additionalProperties: false,
        $defs: {},
      },
      'add_member input',
    )
  },
  validateOutput(value: unknown): asserts value is AddMemberOutput {
    assertSchema(value, { type: 'null' }, 'add_member output')
  },
}

export const operationAddMemberEmail: Validators<AddMemberEmailInput, AddMemberEmailOutput> = {
  validateInput(value: unknown): asserts value is AddMemberEmailInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          member_id: { title: 'Member Id', type: 'string' },
          email: { title: 'Email', type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
        },
        required: ['member_id', 'email'],
        additionalProperties: false,
        $defs: {},
      },
      'add_member_email input',
    )
  },
  validateOutput(value: unknown): asserts value is AddMemberEmailOutput {
    assertSchema(value, { type: 'null' }, 'add_member_email output')
  },
}

export const operationAddMemberToGroups: Validators<
  AddMemberToGroupsInput,
  AddMemberToGroupsOutput
> = {
  validateInput(value: unknown): asserts value is AddMemberToGroupsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          member_id: { title: 'Member Id', type: 'string' },
          group_ids: { items: { type: 'string' }, title: 'Group Ids', type: 'array' },
        },
        required: ['member_id', 'group_ids'],
        additionalProperties: false,
        $defs: {},
      },
      'add_member_to_groups input',
    )
  },
  validateOutput(value: unknown): asserts value is AddMemberToGroupsOutput {
    assertSchema(value, { type: 'null' }, 'add_member_to_groups output')
  },
}

export const operationAddMemberToMailingLists: Validators<
  AddMemberToMailingListsInput,
  AddMemberToMailingListsOutput
> = {
  validateInput(value: unknown): asserts value is AddMemberToMailingListsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          member_id: { title: 'Member Id', type: 'string' },
          list_ids: { items: { type: 'string' }, title: 'List Ids', type: 'array' },
        },
        required: ['member_id', 'list_ids'],
        additionalProperties: false,
        $defs: {},
      },
      'add_member_to_mailing_lists input',
    )
  },
  validateOutput(value: unknown): asserts value is AddMemberToMailingListsOutput {
    assertSchema(value, { type: 'null' }, 'add_member_to_mailing_lists output')
  },
}

export const operationChangeMemberPassword: Validators<
  ChangeMemberPasswordInput,
  ChangeMemberPasswordOutput
> = {
  validateInput(value: unknown): asserts value is ChangeMemberPasswordInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          member_id: { title: 'Member Id', type: 'string' },
          new_password: { title: 'New Password', type: 'string' },
        },
        required: ['member_id', 'new_password'],
        additionalProperties: false,
        $defs: {},
      },
      'change_member_password input',
    )
  },
  validateOutput(value: unknown): asserts value is ChangeMemberPasswordOutput {
    assertSchema(value, { type: 'null' }, 'change_member_password output')
  },
}

export const operationDeleteAccountRequests: Validators<
  DeleteAccountRequestsInput,
  DeleteAccountRequestsOutput
> = {
  validateInput(value: unknown): asserts value is DeleteAccountRequestsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { names: { items: { type: 'string' }, title: 'Names', type: 'array' } },
        required: ['names'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_account_requests input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteAccountRequestsOutput {
    assertSchema(value, { type: 'null' }, 'delete_account_requests output')
  },
}

export const operationDeleteDomain: Validators<DeleteDomainInput, DeleteDomainOutput> = {
  validateInput(value: unknown): asserts value is DeleteDomainInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { domain_id: { title: 'Domain Id', type: 'string' } },
        required: ['domain_id'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_domain input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteDomainOutput {
    assertSchema(value, { type: 'null' }, 'delete_domain output')
  },
}

export const operationDeleteGroups: Validators<DeleteGroupsInput, DeleteGroupsOutput> = {
  validateInput(value: unknown): asserts value is DeleteGroupsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { ids: { items: { type: 'string' }, title: 'Ids', type: 'array' } },
        required: ['ids'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_groups input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteGroupsOutput {
    assertSchema(value, { type: 'null' }, 'delete_groups output')
  },
}

export const operationDeleteMailingLists: Validators<
  DeleteMailingListsInput,
  DeleteMailingListsOutput
> = {
  validateInput(value: unknown): asserts value is DeleteMailingListsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { ids: { items: { type: 'string' }, title: 'Ids', type: 'array' } },
        required: ['ids'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_mailing_lists input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteMailingListsOutput {
    assertSchema(value, { type: 'null' }, 'delete_mailing_lists output')
  },
}

export const operationDeleteMembers: Validators<DeleteMembersInput, DeleteMembersOutput> = {
  validateInput(value: unknown): asserts value is DeleteMembersInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { names: { items: { type: 'string' }, title: 'Names', type: 'array' } },
        required: ['names'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_members input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteMembersOutput {
    assertSchema(value, { type: 'null' }, 'delete_members output')
  },
}

export const operationDisableMembers: Validators<DisableMembersInput, DisableMembersOutput> = {
  validateInput(value: unknown): asserts value is DisableMembersInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { names: { items: { type: 'string' }, title: 'Names', type: 'array' } },
        required: ['names'],
        additionalProperties: false,
        $defs: {},
      },
      'disable_members input',
    )
  },
  validateOutput(value: unknown): asserts value is DisableMembersOutput {
    assertSchema(value, { type: 'null' }, 'disable_members output')
  },
}

export const operationEnableMembers: Validators<EnableMembersInput, EnableMembersOutput> = {
  validateInput(value: unknown): asserts value is EnableMembersInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { names: { items: { type: 'string' }, title: 'Names', type: 'array' } },
        required: ['names'],
        additionalProperties: false,
        $defs: {},
      },
      'enable_members input',
    )
  },
  validateOutput(value: unknown): asserts value is EnableMembersOutput {
    assertSchema(value, { type: 'null' }, 'enable_members output')
  },
}

export const operationGetAccountOptions: Validators<
  GetAccountOptionsInput,
  GetAccountOptionsOutput
> = {
  validateInput(value: unknown): asserts value is GetAccountOptionsInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_account_options input',
    )
  },
  validateOutput(value: unknown): asserts value is GetAccountOptionsOutput {
    assertSchema(
      value,
      {
        $defs: {
          Option: {
            properties: {
              value: { title: 'Value', type: 'string' },
              label: { title: 'Label', type: 'string' },
            },
            required: ['value', 'label'],
            title: 'Option',
            type: 'object',
          },
        },
        properties: {
          locales: { items: { $ref: '#/$defs/Option' }, title: 'Locales', type: 'array' },
          time_zones: { items: { $ref: '#/$defs/Option' }, title: 'Time Zones', type: 'array' },
        },
        required: ['locales', 'time_zones'],
        title: 'AccountOptions',
        type: 'object',
      },
      'get_account_options output',
    )
  },
}

export const operationGetAccounts: Validators<GetAccountsInput, GetAccountsOutput> = {
  validateInput(value: unknown): asserts value is GetAccountsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          search: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Search' },
          limit: { title: 'Limit', type: 'integer' },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'get_accounts input',
    )
  },
  validateOutput(value: unknown): asserts value is GetAccountsOutput {
    assertSchema(
      value,
      {
        $defs: {
          AddressRef: {
            properties: {
              id: { title: 'Id', type: 'string' },
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
            },
            required: ['id', 'name', 'email'],
            title: 'AddressRef',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/AddressRef' },
        type: 'array',
      },
      'get_accounts output',
    )
  },
}

export const operationGetDomain: Validators<GetDomainInput, GetDomainOutput> = {
  validateInput(value: unknown): asserts value is GetDomainInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { domain_id: { title: 'Domain Id', type: 'string' } },
        required: ['domain_id'],
        additionalProperties: false,
        $defs: {},
      },
      'get_domain input',
    )
  },
  validateOutput(value: unknown): asserts value is GetDomainOutput {
    assertSchema(
      value,
      {
        $defs: {
          DnsGroup: {
            properties: {
              key: { title: 'Key', type: 'string' },
              label: { title: 'Label', type: 'string' },
              description: { title: 'Description', type: 'string' },
              is_mandatory: { title: 'Is Mandatory', type: 'boolean' },
            },
            required: ['key', 'label', 'description', 'is_mandatory'],
            title: 'DnsGroup',
            type: 'object',
          },
          DnsRecord: {
            properties: {
              type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Type' },
              host: { title: 'Host', type: 'string' },
              fqdn: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Fqdn' },
              value: { title: 'Value', type: 'string' },
              priority: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Priority' },
              weight: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Weight' },
              port: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Port' },
              ttl: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Ttl' },
              category: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Category' },
              group: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Group' },
              is_mandatory: { title: 'Is Mandatory', type: 'boolean' },
              is_verified: { title: 'Is Verified', type: 'boolean' },
              last_checked_at: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Last Checked At',
              },
            },
            required: [
              'type',
              'host',
              'fqdn',
              'value',
              'priority',
              'weight',
              'port',
              'ttl',
              'category',
              'group',
              'is_mandatory',
              'is_verified',
              'last_checked_at',
            ],
            title: 'DnsRecord',
            type: 'object',
          },
        },
        properties: {
          id: { title: 'Id', type: 'string' },
          name: { title: 'Name', type: 'string' },
          description: { title: 'Description', type: 'string' },
          status: {
            enum: ['Active', 'Pending Verification', 'Disabled'],
            title: 'Status',
            type: 'string',
          },
          is_enabled: { title: 'Is Enabled', type: 'boolean' },
          catch_all_address: { title: 'Catch All Address', type: 'string' },
          sub_addressing: { title: 'Sub Addressing', type: 'boolean' },
          allow_relaying: { title: 'Allow Relaying', type: 'boolean' },
          is_verified: { title: 'Is Verified', type: 'boolean' },
          last_verified_at: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Last Verified At',
          },
          created_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created At' },
          dns_record_groups: {
            items: { $ref: '#/$defs/DnsGroup' },
            title: 'Dns Record Groups',
            type: 'array',
          },
          dns_records: {
            items: { $ref: '#/$defs/DnsRecord' },
            title: 'Dns Records',
            type: 'array',
          },
        },
        required: [
          'id',
          'name',
          'description',
          'status',
          'is_enabled',
          'catch_all_address',
          'sub_addressing',
          'allow_relaying',
          'is_verified',
          'last_verified_at',
          'created_at',
          'dns_record_groups',
          'dns_records',
        ],
        title: 'Domain',
        type: 'object',
      },
      'get_domain output',
    )
  },
}

export const operationGetDomainDnsCsv: Validators<GetDomainDnsCsvInput, GetDomainDnsCsvOutput> = {
  validateInput(value: unknown): asserts value is GetDomainDnsCsvInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { domain_id: { title: 'Domain Id', type: 'string' } },
        required: ['domain_id'],
        additionalProperties: false,
        $defs: {},
      },
      'get_domain_dns_csv input',
    )
  },
  validateOutput(value: unknown): asserts value is GetDomainDnsCsvOutput {
    assertSchema(value, { type: 'string' }, 'get_domain_dns_csv output')
  },
}

export const operationGetDomainDnsJson: Validators<GetDomainDnsJsonInput, GetDomainDnsJsonOutput> =
  {
    validateInput(value: unknown): asserts value is GetDomainDnsJsonInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: { domain_id: { title: 'Domain Id', type: 'string' } },
          required: ['domain_id'],
          additionalProperties: false,
          $defs: {},
        },
        'get_domain_dns_json input',
      )
    },
    validateOutput(value: unknown): asserts value is GetDomainDnsJsonOutput {
      assertSchema(value, { type: 'string' }, 'get_domain_dns_json output')
    },
  }

export const operationGetDomainDnsZone: Validators<GetDomainDnsZoneInput, GetDomainDnsZoneOutput> =
  {
    validateInput(value: unknown): asserts value is GetDomainDnsZoneInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: { domain_id: { title: 'Domain Id', type: 'string' } },
          required: ['domain_id'],
          additionalProperties: false,
          $defs: {},
        },
        'get_domain_dns_zone input',
      )
    },
    validateOutput(value: unknown): asserts value is GetDomainDnsZoneOutput {
      assertSchema(value, { type: 'string' }, 'get_domain_dns_zone output')
    },
  }

export const operationGetDomainOwnershipRecord: Validators<
  GetDomainOwnershipRecordInput,
  GetDomainOwnershipRecordOutput
> = {
  validateInput(value: unknown): asserts value is GetDomainOwnershipRecordInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { title: 'Name', type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'get_domain_ownership_record input',
    )
  },
  validateOutput(value: unknown): asserts value is GetDomainOwnershipRecordOutput {
    assertSchema(
      value,
      {
        $defs: {
          OwnershipRecord: {
            properties: {
              type: { title: 'Type', type: 'string' },
              host: { title: 'Host', type: 'string' },
              fqdn: { title: 'Fqdn', type: 'string' },
              value: { title: 'Value', type: 'string' },
            },
            required: ['type', 'host', 'fqdn', 'value'],
            title: 'OwnershipRecord',
            type: 'object',
          },
        },
        properties: {
          domain: { title: 'Domain', type: 'string' },
          ownership_record: { $ref: '#/$defs/OwnershipRecord' },
        },
        required: ['domain', 'ownership_record'],
        title: 'Ownership',
        type: 'object',
      },
      'get_domain_ownership_record output',
    )
  },
}

export const operationGetEnabledDomains: Validators<
  GetEnabledDomainsInput,
  GetEnabledDomainsOutput
> = {
  validateInput(value: unknown): asserts value is GetEnabledDomainsInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_enabled_domains input',
    )
  },
  validateOutput(value: unknown): asserts value is GetEnabledDomainsOutput {
    assertSchema(value, { items: { type: 'string' }, type: 'array' }, 'get_enabled_domains output')
  },
}

export const operationGetGroup: Validators<GetGroupInput, GetGroupOutput> = {
  validateInput(value: unknown): asserts value is GetGroupInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { group_id: { title: 'Group Id', type: 'string' } },
        required: ['group_id'],
        additionalProperties: false,
        $defs: {},
      },
      'get_group input',
    )
  },
  validateOutput(value: unknown): asserts value is GetGroupOutput {
    assertSchema(
      value,
      {
        $defs: {
          Address: {
            properties: {
              email: { title: 'Email', type: 'string' },
              description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
              is_primary: { title: 'Is Primary', type: 'boolean' },
              enabled: { title: 'Enabled', type: 'boolean' },
            },
            required: ['email', 'description', 'is_primary', 'enabled'],
            title: 'Address',
            type: 'object',
          },
          AddressRef: {
            properties: {
              id: { title: 'Id', type: 'string' },
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
            },
            required: ['id', 'name', 'email'],
            title: 'AddressRef',
            type: 'object',
          },
          Quota: {
            properties: {
              total: { title: 'Total', type: 'integer' },
              used: { title: 'Used', type: 'integer' },
              available: { title: 'Available', type: 'integer' },
              used_percentage: { title: 'Used Percentage', type: 'number' },
              available_percentage: { title: 'Available Percentage', type: 'number' },
              unlimited: { title: 'Unlimited', type: 'boolean' },
            },
            required: [
              'total',
              'used',
              'available',
              'used_percentage',
              'available_percentage',
              'unlimited',
            ],
            title: 'Quota',
            type: 'object',
          },
        },
        properties: {
          id: { title: 'Id', type: 'string' },
          name: { title: 'Name', type: 'string' },
          email: { title: 'Email', type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
          disable_receiving: { title: 'Disable Receiving', type: 'boolean' },
          quota_gb: { title: 'Quota Gb', type: 'number' },
          used_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Used Bytes' },
          created_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created At' },
          email_addresses: {
            items: { $ref: '#/$defs/Address' },
            title: 'Email Addresses',
            type: 'array',
          },
          members: { items: { $ref: '#/$defs/AddressRef' }, title: 'Members', type: 'array' },
          quota: { $ref: '#/$defs/Quota' },
        },
        required: [
          'id',
          'name',
          'email',
          'description',
          'disable_receiving',
          'quota_gb',
          'used_bytes',
          'created_at',
          'email_addresses',
          'members',
          'quota',
        ],
        title: 'Group',
        type: 'object',
      },
      'get_group output',
    )
  },
}

export const operationGetMailingList: Validators<GetMailingListInput, GetMailingListOutput> = {
  validateInput(value: unknown): asserts value is GetMailingListInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          list_id: { title: 'List Id', type: 'string' },
          start: { title: 'Start', type: 'integer' },
          limit: { title: 'Limit', type: 'integer' },
          search: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Search' },
        },
        required: ['list_id'],
        additionalProperties: false,
        $defs: {},
      },
      'get_mailing_list input',
    )
  },
  validateOutput(value: unknown): asserts value is GetMailingListOutput {
    assertSchema(
      value,
      {
        $defs: {
          Address: {
            properties: {
              email: { title: 'Email', type: 'string' },
              description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
              is_primary: { title: 'Is Primary', type: 'boolean' },
              enabled: { title: 'Enabled', type: 'boolean' },
            },
            required: ['email', 'description', 'is_primary', 'enabled'],
            title: 'Address',
            type: 'object',
          },
          RecipientRow: {
            properties: {
              email: { title: 'Email', type: 'string' },
              enabled: { title: 'Enabled', type: 'boolean' },
            },
            required: ['email', 'enabled'],
            title: 'RecipientRow',
            type: 'object',
          },
        },
        properties: {
          id: { title: 'Id', type: 'string' },
          name: { title: 'Name', type: 'string' },
          email: { title: 'Email', type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
          recipient_count: { title: 'Recipient Count', type: 'integer' },
          email_addresses: {
            items: { $ref: '#/$defs/Address' },
            title: 'Email Addresses',
            type: 'array',
          },
          recipients: { items: { type: 'string' }, title: 'Recipients', type: 'array' },
          recipient_rows: {
            items: { $ref: '#/$defs/RecipientRow' },
            title: 'Recipient Rows',
            type: 'array',
          },
          recipient_total: { title: 'Recipient Total', type: 'integer' },
        },
        required: [
          'id',
          'name',
          'email',
          'description',
          'recipient_count',
          'email_addresses',
          'recipients',
          'recipient_rows',
          'recipient_total',
        ],
        title: 'MailingList',
        type: 'object',
      },
      'get_mailing_list output',
    )
  },
}

export const operationGetMember: Validators<GetMemberInput, GetMemberOutput> = {
  validateInput(value: unknown): asserts value is GetMemberInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { member_id: { title: 'Member Id', type: 'string' } },
        required: ['member_id'],
        additionalProperties: false,
        $defs: {},
      },
      'get_member input',
    )
  },
  validateOutput(value: unknown): asserts value is GetMemberOutput {
    assertSchema(
      value,
      {
        $defs: {
          Address: {
            properties: {
              email: { title: 'Email', type: 'string' },
              description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
              is_primary: { title: 'Is Primary', type: 'boolean' },
              enabled: { title: 'Enabled', type: 'boolean' },
            },
            required: ['email', 'description', 'is_primary', 'enabled'],
            title: 'Address',
            type: 'object',
          },
          AddressRef: {
            properties: {
              id: { title: 'Id', type: 'string' },
              name: { title: 'Name', type: 'string' },
              email: { title: 'Email', type: 'string' },
            },
            required: ['id', 'name', 'email'],
            title: 'AddressRef',
            type: 'object',
          },
          Quota: {
            properties: {
              total: { title: 'Total', type: 'integer' },
              used: { title: 'Used', type: 'integer' },
              available: { title: 'Available', type: 'integer' },
              used_percentage: { title: 'Used Percentage', type: 'number' },
              available_percentage: { title: 'Available Percentage', type: 'number' },
              unlimited: { title: 'Unlimited', type: 'boolean' },
            },
            required: [
              'total',
              'used',
              'available',
              'used_percentage',
              'available_percentage',
              'unlimited',
            ],
            title: 'Quota',
            type: 'object',
          },
        },
        properties: {
          name: { title: 'Name', type: 'string' },
          full_name: { title: 'Full Name', type: 'string' },
          user_image: { title: 'User Image', type: 'string' },
          description: { title: 'Description', type: 'string' },
          last_active: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Last Active' },
          joined_on: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Joined On' },
          enabled: { title: 'Enabled', type: 'boolean' },
          is_admin: { title: 'Is Admin', type: 'boolean' },
          account: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Account' },
          email_addresses: {
            items: { $ref: '#/$defs/Address' },
            title: 'Email Addresses',
            type: 'array',
          },
          groups: { items: { $ref: '#/$defs/AddressRef' }, title: 'Groups', type: 'array' },
          mailing_lists: {
            items: { $ref: '#/$defs/AddressRef' },
            title: 'Mailing Lists',
            type: 'array',
          },
          quota: { $ref: '#/$defs/Quota' },
          locale: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Locale' },
          time_zone: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Time Zone' },
          disable_receiving: { title: 'Disable Receiving', type: 'boolean' },
        },
        required: [
          'name',
          'full_name',
          'user_image',
          'description',
          'last_active',
          'joined_on',
          'enabled',
          'is_admin',
          'account',
          'email_addresses',
          'groups',
          'mailing_lists',
          'quota',
          'locale',
          'time_zone',
          'disable_receiving',
        ],
        title: 'Member',
        type: 'object',
      },
      'get_member output',
    )
  },
}

export const operationRemoveGroupEmail: Validators<RemoveGroupEmailInput, RemoveGroupEmailOutput> =
  {
    validateInput(value: unknown): asserts value is RemoveGroupEmailInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: {
            group_id: { title: 'Group Id', type: 'string' },
            email: { title: 'Email', type: 'string' },
          },
          required: ['group_id', 'email'],
          additionalProperties: false,
          $defs: {},
        },
        'remove_group_email input',
      )
    },
    validateOutput(value: unknown): asserts value is RemoveGroupEmailOutput {
      assertSchema(value, { type: 'null' }, 'remove_group_email output')
    },
  }

export const operationRemoveGroupMember: Validators<
  RemoveGroupMemberInput,
  RemoveGroupMemberOutput
> = {
  validateInput(value: unknown): asserts value is RemoveGroupMemberInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          group_id: { title: 'Group Id', type: 'string' },
          account_id: { title: 'Account Id', type: 'string' },
        },
        required: ['group_id', 'account_id'],
        additionalProperties: false,
        $defs: {},
      },
      'remove_group_member input',
    )
  },
  validateOutput(value: unknown): asserts value is RemoveGroupMemberOutput {
    assertSchema(value, { type: 'null' }, 'remove_group_member output')
  },
}

export const operationRemoveMailingListEmail: Validators<
  RemoveMailingListEmailInput,
  RemoveMailingListEmailOutput
> = {
  validateInput(value: unknown): asserts value is RemoveMailingListEmailInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          list_id: { title: 'List Id', type: 'string' },
          email: { title: 'Email', type: 'string' },
        },
        required: ['list_id', 'email'],
        additionalProperties: false,
        $defs: {},
      },
      'remove_mailing_list_email input',
    )
  },
  validateOutput(value: unknown): asserts value is RemoveMailingListEmailOutput {
    assertSchema(value, { type: 'null' }, 'remove_mailing_list_email output')
  },
}

export const operationRemoveMailingListRecipient: Validators<
  RemoveMailingListRecipientInput,
  RemoveMailingListRecipientOutput
> = {
  validateInput(value: unknown): asserts value is RemoveMailingListRecipientInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          list_id: { title: 'List Id', type: 'string' },
          email: { title: 'Email', type: 'string' },
        },
        required: ['list_id', 'email'],
        additionalProperties: false,
        $defs: {},
      },
      'remove_mailing_list_recipient input',
    )
  },
  validateOutput(value: unknown): asserts value is RemoveMailingListRecipientOutput {
    assertSchema(value, { type: 'null' }, 'remove_mailing_list_recipient output')
  },
}

export const operationRemoveMemberEmail: Validators<
  RemoveMemberEmailInput,
  RemoveMemberEmailOutput
> = {
  validateInput(value: unknown): asserts value is RemoveMemberEmailInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          member_id: { title: 'Member Id', type: 'string' },
          email: { title: 'Email', type: 'string' },
        },
        required: ['member_id', 'email'],
        additionalProperties: false,
        $defs: {},
      },
      'remove_member_email input',
    )
  },
  validateOutput(value: unknown): asserts value is RemoveMemberEmailOutput {
    assertSchema(value, { type: 'null' }, 'remove_member_email output')
  },
}

export const operationRemoveMemberFromGroup: Validators<
  RemoveMemberFromGroupInput,
  RemoveMemberFromGroupOutput
> = {
  validateInput(value: unknown): asserts value is RemoveMemberFromGroupInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          member_id: { title: 'Member Id', type: 'string' },
          group_id: { title: 'Group Id', type: 'string' },
        },
        required: ['member_id', 'group_id'],
        additionalProperties: false,
        $defs: {},
      },
      'remove_member_from_group input',
    )
  },
  validateOutput(value: unknown): asserts value is RemoveMemberFromGroupOutput {
    assertSchema(value, { type: 'null' }, 'remove_member_from_group output')
  },
}

export const operationRemoveMemberFromMailingList: Validators<
  RemoveMemberFromMailingListInput,
  RemoveMemberFromMailingListOutput
> = {
  validateInput(value: unknown): asserts value is RemoveMemberFromMailingListInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          member_id: { title: 'Member Id', type: 'string' },
          list_id: { title: 'List Id', type: 'string' },
        },
        required: ['member_id', 'list_id'],
        additionalProperties: false,
        $defs: {},
      },
      'remove_member_from_mailing_list input',
    )
  },
  validateOutput(value: unknown): asserts value is RemoveMemberFromMailingListOutput {
    assertSchema(value, { type: 'null' }, 'remove_member_from_mailing_list output')
  },
}

export const operationSetDomainEnabled: Validators<SetDomainEnabledInput, SetDomainEnabledOutput> =
  {
    validateInput(value: unknown): asserts value is SetDomainEnabledInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: {
            domain_id: { title: 'Domain Id', type: 'string' },
            enabled: { title: 'Enabled', type: 'boolean' },
          },
          required: ['domain_id', 'enabled'],
          additionalProperties: false,
          $defs: {},
        },
        'set_domain_enabled input',
      )
    },
    validateOutput(value: unknown): asserts value is SetDomainEnabledOutput {
      assertSchema(
        value,
        {
          properties: {
            id: { title: 'Id', type: 'string' },
            name: { title: 'Name', type: 'string' },
            description: { title: 'Description', type: 'string' },
            status: {
              enum: ['Active', 'Pending Verification', 'Disabled'],
              title: 'Status',
              type: 'string',
            },
            is_enabled: { title: 'Is Enabled', type: 'boolean' },
            catch_all_address: { title: 'Catch All Address', type: 'string' },
            sub_addressing: { title: 'Sub Addressing', type: 'boolean' },
            allow_relaying: { title: 'Allow Relaying', type: 'boolean' },
            is_verified: { title: 'Is Verified', type: 'boolean' },
            last_verified_at: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              title: 'Last Verified At',
            },
            created_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created At' },
          },
          required: [
            'id',
            'name',
            'description',
            'status',
            'is_enabled',
            'catch_all_address',
            'sub_addressing',
            'allow_relaying',
            'is_verified',
            'last_verified_at',
            'created_at',
          ],
          title: 'DomainRow',
          type: 'object',
        },
        'set_domain_enabled output',
      )
    },
  }

export const operationSetGroupEmailEnabled: Validators<
  SetGroupEmailEnabledInput,
  SetGroupEmailEnabledOutput
> = {
  validateInput(value: unknown): asserts value is SetGroupEmailEnabledInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          group_id: { title: 'Group Id', type: 'string' },
          email: { title: 'Email', type: 'string' },
          enabled: { title: 'Enabled', type: 'integer' },
        },
        required: ['group_id', 'email', 'enabled'],
        additionalProperties: false,
        $defs: {},
      },
      'set_group_email_enabled input',
    )
  },
  validateOutput(value: unknown): asserts value is SetGroupEmailEnabledOutput {
    assertSchema(value, { type: 'null' }, 'set_group_email_enabled output')
  },
}

export const operationSetGroupReceivingEnabled: Validators<
  SetGroupReceivingEnabledInput,
  SetGroupReceivingEnabledOutput
> = {
  validateInput(value: unknown): asserts value is SetGroupReceivingEnabledInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          group_id: { title: 'Group Id', type: 'string' },
          enabled: { title: 'Enabled', type: 'boolean' },
        },
        required: ['group_id', 'enabled'],
        additionalProperties: false,
        $defs: {},
      },
      'set_group_receiving_enabled input',
    )
  },
  validateOutput(value: unknown): asserts value is SetGroupReceivingEnabledOutput {
    assertSchema(value, { type: 'null' }, 'set_group_receiving_enabled output')
  },
}

export const operationSetMailingListEmailEnabled: Validators<
  SetMailingListEmailEnabledInput,
  SetMailingListEmailEnabledOutput
> = {
  validateInput(value: unknown): asserts value is SetMailingListEmailEnabledInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          list_id: { title: 'List Id', type: 'string' },
          email: { title: 'Email', type: 'string' },
          enabled: { title: 'Enabled', type: 'integer' },
        },
        required: ['list_id', 'email', 'enabled'],
        additionalProperties: false,
        $defs: {},
      },
      'set_mailing_list_email_enabled input',
    )
  },
  validateOutput(value: unknown): asserts value is SetMailingListEmailEnabledOutput {
    assertSchema(value, { type: 'null' }, 'set_mailing_list_email_enabled output')
  },
}

export const operationSetMemberEmailEnabled: Validators<
  SetMemberEmailEnabledInput,
  SetMemberEmailEnabledOutput
> = {
  validateInput(value: unknown): asserts value is SetMemberEmailEnabledInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          member_id: { title: 'Member Id', type: 'string' },
          email: { title: 'Email', type: 'string' },
          enabled: { title: 'Enabled', type: 'integer' },
        },
        required: ['member_id', 'email', 'enabled'],
        additionalProperties: false,
        $defs: {},
      },
      'set_member_email_enabled input',
    )
  },
  validateOutput(value: unknown): asserts value is SetMemberEmailEnabledOutput {
    assertSchema(value, { type: 'null' }, 'set_member_email_enabled output')
  },
}

export const operationSetMemberReceivingEnabled: Validators<
  SetMemberReceivingEnabledInput,
  SetMemberReceivingEnabledOutput
> = {
  validateInput(value: unknown): asserts value is SetMemberReceivingEnabledInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          member_id: { title: 'Member Id', type: 'string' },
          enabled: { title: 'Enabled', type: 'boolean' },
        },
        required: ['member_id', 'enabled'],
        additionalProperties: false,
        $defs: {},
      },
      'set_member_receiving_enabled input',
    )
  },
  validateOutput(value: unknown): asserts value is SetMemberReceivingEnabledOutput {
    assertSchema(value, { type: 'null' }, 'set_member_receiving_enabled output')
  },
}

export const operationUpdateDomain: Validators<UpdateDomainInput, UpdateDomainOutput> = {
  validateInput(value: unknown): asserts value is UpdateDomainInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          domain_id: { title: 'Domain Id', type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
          catch_all_address: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Catch All Address',
          },
          sub_addressing: {
            anyOf: [{ type: 'boolean' }, { type: 'null' }],
            title: 'Sub Addressing',
          },
          allow_relaying: {
            anyOf: [{ type: 'boolean' }, { type: 'null' }],
            title: 'Allow Relaying',
          },
        },
        required: ['domain_id'],
        additionalProperties: false,
        $defs: {},
      },
      'update_domain input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateDomainOutput {
    assertSchema(
      value,
      {
        $defs: {
          DnsGroup: {
            properties: {
              key: { title: 'Key', type: 'string' },
              label: { title: 'Label', type: 'string' },
              description: { title: 'Description', type: 'string' },
              is_mandatory: { title: 'Is Mandatory', type: 'boolean' },
            },
            required: ['key', 'label', 'description', 'is_mandatory'],
            title: 'DnsGroup',
            type: 'object',
          },
          DnsRecord: {
            properties: {
              type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Type' },
              host: { title: 'Host', type: 'string' },
              fqdn: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Fqdn' },
              value: { title: 'Value', type: 'string' },
              priority: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Priority' },
              weight: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Weight' },
              port: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Port' },
              ttl: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Ttl' },
              category: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Category' },
              group: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Group' },
              is_mandatory: { title: 'Is Mandatory', type: 'boolean' },
              is_verified: { title: 'Is Verified', type: 'boolean' },
              last_checked_at: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Last Checked At',
              },
            },
            required: [
              'type',
              'host',
              'fqdn',
              'value',
              'priority',
              'weight',
              'port',
              'ttl',
              'category',
              'group',
              'is_mandatory',
              'is_verified',
              'last_checked_at',
            ],
            title: 'DnsRecord',
            type: 'object',
          },
          Domain: {
            properties: {
              id: { title: 'Id', type: 'string' },
              name: { title: 'Name', type: 'string' },
              description: { title: 'Description', type: 'string' },
              status: {
                enum: ['Active', 'Pending Verification', 'Disabled'],
                title: 'Status',
                type: 'string',
              },
              is_enabled: { title: 'Is Enabled', type: 'boolean' },
              catch_all_address: { title: 'Catch All Address', type: 'string' },
              sub_addressing: { title: 'Sub Addressing', type: 'boolean' },
              allow_relaying: { title: 'Allow Relaying', type: 'boolean' },
              is_verified: { title: 'Is Verified', type: 'boolean' },
              last_verified_at: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Last Verified At',
              },
              created_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created At' },
              dns_record_groups: {
                items: { $ref: '#/$defs/DnsGroup' },
                title: 'Dns Record Groups',
                type: 'array',
              },
              dns_records: {
                items: { $ref: '#/$defs/DnsRecord' },
                title: 'Dns Records',
                type: 'array',
              },
            },
            required: [
              'id',
              'name',
              'description',
              'status',
              'is_enabled',
              'catch_all_address',
              'sub_addressing',
              'allow_relaying',
              'is_verified',
              'last_verified_at',
              'created_at',
              'dns_record_groups',
              'dns_records',
            ],
            title: 'Domain',
            type: 'object',
          },
          DomainRow: {
            properties: {
              id: { title: 'Id', type: 'string' },
              name: { title: 'Name', type: 'string' },
              description: { title: 'Description', type: 'string' },
              status: {
                enum: ['Active', 'Pending Verification', 'Disabled'],
                title: 'Status',
                type: 'string',
              },
              is_enabled: { title: 'Is Enabled', type: 'boolean' },
              catch_all_address: { title: 'Catch All Address', type: 'string' },
              sub_addressing: { title: 'Sub Addressing', type: 'boolean' },
              allow_relaying: { title: 'Allow Relaying', type: 'boolean' },
              is_verified: { title: 'Is Verified', type: 'boolean' },
              last_verified_at: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Last Verified At',
              },
              created_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Created At' },
            },
            required: [
              'id',
              'name',
              'description',
              'status',
              'is_enabled',
              'catch_all_address',
              'sub_addressing',
              'allow_relaying',
              'is_verified',
              'last_verified_at',
              'created_at',
            ],
            title: 'DomainRow',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/DomainRow' }, { $ref: '#/$defs/Domain' }],
      },
      'update_domain output',
    )
  },
}

export const operationUpdateGroup: Validators<UpdateGroupInput, UpdateGroupOutput> = {
  validateInput(value: unknown): asserts value is UpdateGroupInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          group_id: { title: 'Group Id', type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
          quota_gb: { anyOf: [{ type: 'number' }, { type: 'null' }], title: 'Quota Gb' },
        },
        required: ['group_id'],
        additionalProperties: false,
        $defs: {},
      },
      'update_group input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateGroupOutput {
    assertSchema(value, { type: 'null' }, 'update_group output')
  },
}

export const operationUpdateMailingList: Validators<
  UpdateMailingListInput,
  UpdateMailingListOutput
> = {
  validateInput(value: unknown): asserts value is UpdateMailingListInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          list_id: { title: 'List Id', type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
        },
        required: ['list_id'],
        additionalProperties: false,
        $defs: {},
      },
      'update_mailing_list input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateMailingListOutput {
    assertSchema(value, { type: 'null' }, 'update_mailing_list output')
  },
}

export const operationUpdateMember: Validators<UpdateMemberInput, UpdateMemberOutput> = {
  validateInput(value: unknown): asserts value is UpdateMemberInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          member_id: { title: 'Member Id', type: 'string' },
          role: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Role' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
          quota_gb: { anyOf: [{ type: 'number' }, { type: 'null' }], title: 'Quota Gb' },
          locale: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Locale' },
          time_zone: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Time Zone' },
        },
        required: ['member_id'],
        additionalProperties: false,
        $defs: {},
      },
      'update_member input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateMemberOutput {
    assertSchema(value, { type: 'null' }, 'update_member output')
  },
}

export const operationVerifyDomain: Validators<VerifyDomainInput, VerifyDomainOutput> = {
  validateInput(value: unknown): asserts value is VerifyDomainInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { domain_id: { title: 'Domain Id', type: 'string' } },
        required: ['domain_id'],
        additionalProperties: false,
        $defs: {},
      },
      'verify_domain input',
    )
  },
  validateOutput(value: unknown): asserts value is VerifyDomainOutput {
    assertSchema(
      value,
      {
        properties: { is_verified: { title: 'Is Verified', type: 'boolean' } },
        required: ['is_verified'],
        title: 'Verification',
        type: 'object',
      },
      'verify_domain output',
    )
  },
}

export const operationAddIdentity: Validators<AddIdentityInput, AddIdentityOutput> = {
  validateInput(value: unknown): asserts value is AddIdentityInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          email: { title: 'Email', type: 'string' },
          name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Name' },
          reply_to: {
            anyOf: [{ items: { $ref: '#/$defs/Address' }, type: 'array' }, { type: 'null' }],
            title: 'Reply To',
          },
          bcc: {
            anyOf: [{ items: { $ref: '#/$defs/Address' }, type: 'array' }, { type: 'null' }],
            title: 'Bcc',
          },
          text_signature: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Text Signature',
          },
          html_signature: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Html Signature',
          },
        },
        required: ['account', 'email'],
        additionalProperties: false,
        $defs: {
          Address: {
            properties: {
              display_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Display Name',
              },
              email: { title: 'Email', type: 'string' },
            },
            required: ['display_name', 'email'],
            title: 'Address',
            type: 'object',
          },
        },
      },
      'add_identity input',
    )
  },
  validateOutput(value: unknown): asserts value is AddIdentityOutput {
    assertSchema(value, { type: 'string' }, 'add_identity output')
  },
}

export const operationDeleteIdentityNames: Validators<
  DeleteIdentityNamesInput,
  DeleteIdentityNamesOutput
> = {
  validateInput(value: unknown): asserts value is DeleteIdentityNamesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { names: { items: { type: 'string' }, title: 'Names', type: 'array' } },
        required: ['names'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_identity_names input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteIdentityNamesOutput {
    assertSchema(value, { type: 'null' }, 'delete_identity_names output')
  },
}

export const operationGetDmarcReport: Validators<GetDmarcReportInput, GetDmarcReportOutput> = {
  validateInput(value: unknown): asserts value is GetDmarcReportInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { report_id: { title: 'Report Id', type: 'string' } },
        required: ['report_id'],
        additionalProperties: false,
        $defs: {},
      },
      'get_dmarc_report input',
    )
  },
  validateOutput(value: unknown): asserts value is GetDmarcReportOutput {
    assertSchema(
      value,
      {
        $defs: {
          AuthenticationResult: {
            properties: {
              domain: { title: 'Domain', type: 'string' },
              selector: { title: 'Selector', type: 'string' },
              scope: { title: 'Scope', type: 'string' },
              result: { title: 'Result', type: 'string' },
            },
            title: 'AuthenticationResult',
            type: 'object',
          },
          DmarcPolicy: {
            properties: {
              domain: { title: 'Domain', type: 'string' },
              testing_mode: { title: 'Testing Mode', type: 'boolean' },
              adkim: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Adkim' },
              aspf: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Aspf' },
              p: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'P' },
              sp: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Sp' },
              pct: { title: 'Pct', type: 'integer' },
              fo: { title: 'Fo', type: 'string' },
            },
            title: 'DmarcPolicy',
            type: 'object',
          },
          DmarcRecord: {
            properties: {
              source_ip: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Source Ip' },
              count: { title: 'Count', type: 'integer' },
              disposition: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Disposition' },
              dkim: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Dkim' },
              spf: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Spf' },
              header_from: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Header From' },
              envelope_from: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Envelope From',
              },
              envelope_to: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Envelope To' },
              override_reasons: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Override Reasons',
              },
              dkim_results: {
                items: { $ref: '#/$defs/AuthenticationResult' },
                title: 'Dkim Results',
                type: 'array',
              },
              spf_results: {
                items: { $ref: '#/$defs/AuthenticationResult' },
                title: 'Spf Results',
                type: 'array',
              },
            },
            required: [
              'source_ip',
              'count',
              'disposition',
              'dkim',
              'spf',
              'header_from',
              'envelope_from',
              'envelope_to',
              'override_reasons',
              'dkim_results',
              'spf_results',
            ],
            title: 'DmarcRecord',
            type: 'object',
          },
        },
        properties: {
          id: { title: 'Id', type: 'string' },
          domain: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Domain' },
          reporter: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Reporter' },
          reporter_email: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Reporter Email',
          },
          report_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Report Id' },
          subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
          to: { items: { type: 'string' }, title: 'To', type: 'array' },
          date_range_begin: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Date Range Begin',
          },
          date_range_end: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Date Range End',
          },
          received_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Received At' },
          reports: { title: 'Reports', type: 'integer' },
          version: { anyOf: [{ type: 'number' }, { type: 'null' }], title: 'Version' },
          policy: { $ref: '#/$defs/DmarcPolicy' },
          errors: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Errors' },
          pass_rate: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Pass Rate' },
          messages: { title: 'Messages', type: 'integer' },
          passed: { title: 'Passed', type: 'integer' },
          failed: { title: 'Failed', type: 'integer' },
          dkim_passed: { title: 'Dkim Passed', type: 'integer' },
          spf_passed: { title: 'Spf Passed', type: 'integer' },
          records: { items: { $ref: '#/$defs/DmarcRecord' }, title: 'Records', type: 'array' },
        },
        required: [
          'id',
          'domain',
          'reporter',
          'reporter_email',
          'report_id',
          'subject',
          'to',
          'date_range_begin',
          'date_range_end',
          'received_at',
          'reports',
          'version',
          'policy',
          'errors',
          'pass_rate',
          'messages',
          'passed',
          'failed',
          'dkim_passed',
          'spf_passed',
          'records',
        ],
        title: 'DmarcReport',
        type: 'object',
      },
      'get_dmarc_report output',
    )
  },
}

export const operationGetDmarcSummary: Validators<GetDmarcSummaryInput, GetDmarcSummaryOutput> = {
  validateInput(value: unknown): asserts value is GetDmarcSummaryInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          domain_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Domain Id' },
          days: { title: 'Days', type: 'integer' },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'get_dmarc_summary input',
    )
  },
  validateOutput(value: unknown): asserts value is GetDmarcSummaryOutput {
    assertSchema(
      value,
      {
        $defs: {
          DmarcDomain: {
            properties: {
              reports: { title: 'Reports', type: 'integer' },
              messages: { title: 'Messages', type: 'integer' },
              passed: { title: 'Passed', type: 'integer' },
              failed: { title: 'Failed', type: 'integer' },
              dkim_passed: { title: 'Dkim Passed', type: 'integer' },
              spf_passed: { title: 'Spf Passed', type: 'integer' },
              pass_rate: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Pass Rate' },
              domain: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Domain' },
            },
            required: [
              'reports',
              'messages',
              'passed',
              'failed',
              'dkim_passed',
              'spf_passed',
              'pass_rate',
              'domain',
            ],
            title: 'DmarcDomain',
            type: 'object',
          },
          DmarcReporter: {
            properties: {
              reports: { title: 'Reports', type: 'integer' },
              messages: { title: 'Messages', type: 'integer' },
              passed: { title: 'Passed', type: 'integer' },
              failed: { title: 'Failed', type: 'integer' },
              dkim_passed: { title: 'Dkim Passed', type: 'integer' },
              spf_passed: { title: 'Spf Passed', type: 'integer' },
              pass_rate: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Pass Rate' },
              reporter: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Reporter' },
            },
            required: [
              'reports',
              'messages',
              'passed',
              'failed',
              'dkim_passed',
              'spf_passed',
              'pass_rate',
              'reporter',
            ],
            title: 'DmarcReporter',
            type: 'object',
          },
          DmarcSource: {
            properties: {
              reports: { title: 'Reports', type: 'integer' },
              messages: { title: 'Messages', type: 'integer' },
              passed: { title: 'Passed', type: 'integer' },
              failed: { title: 'Failed', type: 'integer' },
              dkim_passed: { title: 'Dkim Passed', type: 'integer' },
              spf_passed: { title: 'Spf Passed', type: 'integer' },
              pass_rate: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Pass Rate' },
              source_ip: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Source Ip' },
            },
            required: [
              'reports',
              'messages',
              'passed',
              'failed',
              'dkim_passed',
              'spf_passed',
              'pass_rate',
              'source_ip',
            ],
            title: 'DmarcSource',
            type: 'object',
          },
          DmarcTotals: {
            properties: {
              reports: { title: 'Reports', type: 'integer' },
              messages: { title: 'Messages', type: 'integer' },
              passed: { title: 'Passed', type: 'integer' },
              failed: { title: 'Failed', type: 'integer' },
              dkim_passed: { title: 'Dkim Passed', type: 'integer' },
              spf_passed: { title: 'Spf Passed', type: 'integer' },
              pass_rate: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Pass Rate' },
            },
            required: [
              'reports',
              'messages',
              'passed',
              'failed',
              'dkim_passed',
              'spf_passed',
              'pass_rate',
            ],
            title: 'DmarcTotals',
            type: 'object',
          },
        },
        properties: {
          since: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Since' },
          until: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Until' },
          totals: { $ref: '#/$defs/DmarcTotals' },
          domains: { items: { $ref: '#/$defs/DmarcDomain' }, title: 'Domains', type: 'array' },
          sources: { items: { $ref: '#/$defs/DmarcSource' }, title: 'Sources', type: 'array' },
          reporters: {
            items: { $ref: '#/$defs/DmarcReporter' },
            title: 'Reporters',
            type: 'array',
          },
        },
        required: ['since', 'until', 'totals', 'domains', 'sources', 'reporters'],
        title: 'DmarcSummary',
        type: 'object',
      },
      'get_dmarc_summary output',
    )
  },
}

export const operationGetTlsReport: Validators<GetTlsReportInput, GetTlsReportOutput> = {
  validateInput(value: unknown): asserts value is GetTlsReportInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { report_id: { title: 'Report Id', type: 'string' } },
        required: ['report_id'],
        additionalProperties: false,
        $defs: {},
      },
      'get_tls_report input',
    )
  },
  validateOutput(value: unknown): asserts value is GetTlsReportOutput {
    assertSchema(
      value,
      {
        $defs: {
          TlsFailure: {
            properties: {
              result_type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Result Type' },
              count: { title: 'Count', type: 'integer' },
              policy_type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Policy Type' },
              policy_domain: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Policy Domain',
              },
              sending_mta_ip: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Sending Mta Ip',
              },
              receiving_mx_hostname: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Receiving Mx Hostname',
              },
              receiving_mx_helo: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Receiving Mx Helo',
              },
              receiving_ip: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Receiving Ip',
              },
              failure_reason_code: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Failure Reason Code',
              },
              additional_information: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Additional Information',
              },
            },
            required: [
              'result_type',
              'count',
              'policy_type',
              'policy_domain',
              'sending_mta_ip',
              'receiving_mx_hostname',
              'receiving_mx_helo',
              'receiving_ip',
              'failure_reason_code',
              'additional_information',
            ],
            title: 'TlsFailure',
            type: 'object',
          },
          TlsPolicy: {
            properties: {
              policy_type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Policy Type' },
              policy_domain: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Policy Domain',
              },
              mx_hosts: { items: { type: 'string' }, title: 'Mx Hosts', type: 'array' },
              policy_strings: { items: { type: 'string' }, title: 'Policy Strings', type: 'array' },
              successful: { title: 'Successful', type: 'integer' },
              failed: { title: 'Failed', type: 'integer' },
            },
            required: [
              'policy_type',
              'policy_domain',
              'mx_hosts',
              'policy_strings',
              'successful',
              'failed',
            ],
            title: 'TlsPolicy',
            type: 'object',
          },
        },
        properties: {
          id: { title: 'Id', type: 'string' },
          domain: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Domain' },
          reporter: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Reporter' },
          reporter_email: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Reporter Email',
          },
          report_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Report Id' },
          subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
          to: { items: { type: 'string' }, title: 'To', type: 'array' },
          date_range_begin: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Date Range Begin',
          },
          date_range_end: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Date Range End',
          },
          received_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Received At' },
          reports: { title: 'Reports', type: 'integer' },
          contact_info: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Contact Info' },
          policy_types: { items: { type: 'string' }, title: 'Policy Types', type: 'array' },
          successful: { title: 'Successful', type: 'integer' },
          failed: { title: 'Failed', type: 'integer' },
          sessions: { title: 'Sessions', type: 'integer' },
          success_rate: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Success Rate' },
          policies: { items: { $ref: '#/$defs/TlsPolicy' }, title: 'Policies', type: 'array' },
          failures: { items: { $ref: '#/$defs/TlsFailure' }, title: 'Failures', type: 'array' },
        },
        required: [
          'id',
          'domain',
          'reporter',
          'reporter_email',
          'report_id',
          'subject',
          'to',
          'date_range_begin',
          'date_range_end',
          'received_at',
          'reports',
          'contact_info',
          'policy_types',
          'successful',
          'failed',
          'sessions',
          'success_rate',
          'policies',
          'failures',
        ],
        title: 'TlsReport',
        type: 'object',
      },
      'get_tls_report output',
    )
  },
}

export const operationGetTlsSummary: Validators<GetTlsSummaryInput, GetTlsSummaryOutput> = {
  validateInput(value: unknown): asserts value is GetTlsSummaryInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          domain_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Domain Id' },
          days: { title: 'Days', type: 'integer' },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'get_tls_summary input',
    )
  },
  validateOutput(value: unknown): asserts value is GetTlsSummaryOutput {
    assertSchema(
      value,
      {
        $defs: {
          FailureType: {
            properties: {
              result_type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Result Type' },
              reports: { title: 'Reports', type: 'integer' },
              failed: { title: 'Failed', type: 'integer' },
            },
            required: ['result_type', 'reports', 'failed'],
            title: 'FailureType',
            type: 'object',
          },
          TlsDomain: {
            properties: {
              reports: { title: 'Reports', type: 'integer' },
              sessions: { title: 'Sessions', type: 'integer' },
              successful: { title: 'Successful', type: 'integer' },
              failed: { title: 'Failed', type: 'integer' },
              success_rate: {
                anyOf: [{ type: 'integer' }, { type: 'null' }],
                title: 'Success Rate',
              },
              domain: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Domain' },
            },
            required: ['reports', 'sessions', 'successful', 'failed', 'success_rate', 'domain'],
            title: 'TlsDomain',
            type: 'object',
          },
          TlsReporter: {
            properties: {
              reports: { title: 'Reports', type: 'integer' },
              sessions: { title: 'Sessions', type: 'integer' },
              successful: { title: 'Successful', type: 'integer' },
              failed: { title: 'Failed', type: 'integer' },
              success_rate: {
                anyOf: [{ type: 'integer' }, { type: 'null' }],
                title: 'Success Rate',
              },
              reporter: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Reporter' },
            },
            required: ['reports', 'sessions', 'successful', 'failed', 'success_rate', 'reporter'],
            title: 'TlsReporter',
            type: 'object',
          },
          TlsTotals: {
            properties: {
              reports: { title: 'Reports', type: 'integer' },
              sessions: { title: 'Sessions', type: 'integer' },
              successful: { title: 'Successful', type: 'integer' },
              failed: { title: 'Failed', type: 'integer' },
              success_rate: {
                anyOf: [{ type: 'integer' }, { type: 'null' }],
                title: 'Success Rate',
              },
            },
            required: ['reports', 'sessions', 'successful', 'failed', 'success_rate'],
            title: 'TlsTotals',
            type: 'object',
          },
        },
        properties: {
          since: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Since' },
          until: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Until' },
          totals: { $ref: '#/$defs/TlsTotals' },
          domains: { items: { $ref: '#/$defs/TlsDomain' }, title: 'Domains', type: 'array' },
          reporters: { items: { $ref: '#/$defs/TlsReporter' }, title: 'Reporters', type: 'array' },
          failures: { items: { $ref: '#/$defs/FailureType' }, title: 'Failures', type: 'array' },
        },
        required: ['since', 'until', 'totals', 'domains', 'reporters', 'failures'],
        title: 'TlsSummary',
        type: 'object',
      },
      'get_tls_summary output',
    )
  },
}

export const operationGetOverview: Validators<GetOverviewInput, GetOverviewOutput> = {
  validateInput(value: unknown): asserts value is GetOverviewInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_overview input',
    )
  },
  validateOutput(value: unknown): asserts value is GetOverviewOutput {
    assertSchema(
      value,
      {
        $defs: {
          AttentionDomain: {
            properties: {
              name: { title: 'Name', type: 'string' },
              status: { title: 'Status', type: 'string' },
              last_verified_at: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Last Verified At',
              },
            },
            required: ['name', 'status', 'last_verified_at'],
            title: 'AttentionDomain',
            type: 'object',
          },
          DisabledAccount: {
            properties: {
              name: { title: 'Name', type: 'string' },
              full_name: { title: 'Full Name', type: 'string' },
            },
            required: ['name', 'full_name'],
            title: 'DisabledAccount',
            type: 'object',
          },
          InviteCount: {
            properties: {
              pending: { title: 'Pending', type: 'integer' },
              expiring_soon: { title: 'Expiring Soon', type: 'integer' },
              expired: { title: 'Expired', type: 'integer' },
            },
            required: ['pending', 'expiring_soon', 'expired'],
            title: 'InviteCount',
            type: 'object',
          },
          Limits: {
            properties: {
              max_domains: { title: 'Max Domains', type: 'integer' },
              max_accounts: { title: 'Max Accounts', type: 'integer' },
              max_groups: { title: 'Max Groups', type: 'integer' },
              max_mailing_lists: { title: 'Max Mailing Lists', type: 'integer' },
              max_disk_gb: { title: 'Max Disk Gb', type: 'number' },
              default_disk_quota_gb: { title: 'Default Disk Quota Gb', type: 'number' },
            },
            title: 'Limits',
            type: 'object',
          },
          MemberCount: {
            properties: {
              total: { title: 'Total', type: 'integer' },
              disabled: { title: 'Disabled', type: 'integer' },
            },
            required: ['total', 'disabled'],
            title: 'MemberCount',
            type: 'object',
          },
          RecentAccount: {
            properties: {
              name: { title: 'Name', type: 'string' },
              full_name: { title: 'Full Name', type: 'string' },
              user_image: { title: 'User Image', type: 'string' },
              enabled: { title: 'Enabled', type: 'boolean' },
              joined_on: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Joined On' },
            },
            required: ['name', 'full_name', 'user_image', 'enabled', 'joined_on'],
            title: 'RecentAccount',
            type: 'object',
          },
          Site: {
            properties: {
              site: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Site' },
              title: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Title' },
              status: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Status' },
              cluster: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Cluster' },
              mail_hostname: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Mail Hostname',
              },
              jmap_url: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Jmap Url' },
              contact_email: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Contact Email',
              },
            },
            required: [
              'site',
              'title',
              'status',
              'cluster',
              'mail_hostname',
              'jmap_url',
              'contact_email',
            ],
            title: 'Site',
            type: 'object',
          },
          Storage: {
            properties: {
              allocated_gb: {
                anyOf: [{ type: 'number' }, { type: 'null' }],
                title: 'Allocated Gb',
              },
              max_gb: { anyOf: [{ type: 'number' }, { type: 'null' }], title: 'Max Gb' },
              default_quota_gb: {
                anyOf: [{ type: 'number' }, { type: 'null' }],
                title: 'Default Quota Gb',
              },
            },
            required: ['allocated_gb', 'max_gb', 'default_quota_gb'],
            title: 'Storage',
            type: 'object',
          },
          Workspace: {
            properties: {
              name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Name' },
              logo: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Logo' },
            },
            required: ['name', 'logo'],
            title: 'Workspace',
            type: 'object',
          },
        },
        properties: {
          members: { anyOf: [{ $ref: '#/$defs/MemberCount' }, { type: 'null' }] },
          pending_invites: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Pending Invites',
          },
          domains: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Domains' },
          groups: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Groups' },
          mailing_lists: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Mailing Lists' },
          limits: { anyOf: [{ $ref: '#/$defs/Limits' }, { type: 'null' }] },
          storage: { $ref: '#/$defs/Storage' },
          site: { $ref: '#/$defs/Site' },
          domains_needing_attention: {
            items: { $ref: '#/$defs/AttentionDomain' },
            title: 'Domains Needing Attention',
            type: 'array',
          },
          invites: { $ref: '#/$defs/InviteCount' },
          recent_accounts: {
            items: { $ref: '#/$defs/RecentAccount' },
            title: 'Recent Accounts',
            type: 'array',
          },
          disabled_accounts: {
            items: { $ref: '#/$defs/DisabledAccount' },
            title: 'Disabled Accounts',
            type: 'array',
          },
          workspace: { $ref: '#/$defs/Workspace' },
        },
        required: ['members', 'pending_invites', 'domains', 'groups', 'mailing_lists', 'limits'],
        title: 'Overview',
        type: 'object',
      },
      'get_overview output',
    )
  },
}

export const operationGetContactCards: Validators<GetContactCardsInput, GetContactCardsOutput> = {
  validateInput(value: unknown): asserts value is GetContactCardsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          filter: { anyOf: [{ $ref: '#/$defs/ContactFilter' }, { type: 'null' }] },
          limit: { title: 'Limit', type: 'integer' },
          start: { title: 'Start', type: 'integer' },
        },
        required: ['account'],
        additionalProperties: false,
        $defs: {
          ContactFilter: {
            properties: {
              text: { title: 'Text', type: 'string' },
              email: { title: 'Email', type: 'string' },
              name: { title: 'Name', type: 'string' },
              inAddressBook: { title: 'Inaddressbook', type: 'string' },
              notInAddressBook: { title: 'Notinaddressbook', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
              hasEmail: { title: 'Hasemail', type: 'boolean' },
              operator: { title: 'Operator', type: 'string' },
              conditions: {
                items: { $ref: '#/$defs/ContactFilter' },
                title: 'Conditions',
                type: 'array',
              },
            },
            title: 'ContactFilter',
            type: 'object',
          },
        },
      },
      'get_contact_cards input',
    )
  },
  validateOutput(value: unknown): asserts value is GetContactCardsOutput {
    assertSchema(
      value,
      {
        $defs: {
          ContactSummary: {
            properties: {
              id: { title: 'Id', type: 'string' },
              full_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Full Name' },
              kind: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Kind' },
              emails: { items: { $ref: '#/$defs/Email' }, title: 'Emails', type: 'array' },
            },
            required: ['id', 'full_name', 'kind', 'emails'],
            title: 'ContactSummary',
            type: 'object',
          },
          Email: {
            properties: {
              address: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Address' },
              type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Type' },
              label: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Label' },
              contexts: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Contexts' },
            },
            required: ['address'],
            title: 'Email',
            type: 'object',
          },
        },
        properties: {
          rows: { items: { $ref: '#/$defs/ContactSummary' }, title: 'Rows', type: 'array' },
          total: { title: 'Total', type: 'integer' },
        },
        required: ['rows', 'total'],
        title: 'ContactPage',
        type: 'object',
      },
      'get_contact_cards output',
    )
  },
}

export const operationGetContacts: Validators<GetContactsInput, GetContactsOutput> = {
  validateInput(value: unknown): asserts value is GetContactsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          filter: { anyOf: [{ $ref: '#/$defs/ContactFilter' }, { type: 'null' }] },
          limit: { title: 'Limit', type: 'integer' },
          start: { title: 'Start', type: 'integer' },
        },
        required: ['account'],
        additionalProperties: false,
        $defs: {
          ContactFilter: {
            properties: {
              text: { title: 'Text', type: 'string' },
              email: { title: 'Email', type: 'string' },
              name: { title: 'Name', type: 'string' },
              inAddressBook: { title: 'Inaddressbook', type: 'string' },
              notInAddressBook: { title: 'Notinaddressbook', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
              hasEmail: { title: 'Hasemail', type: 'boolean' },
              operator: { title: 'Operator', type: 'string' },
              conditions: {
                items: { $ref: '#/$defs/ContactFilter' },
                title: 'Conditions',
                type: 'array',
              },
            },
            title: 'ContactFilter',
            type: 'object',
          },
        },
      },
      'get_contacts input',
    )
  },
  validateOutput(value: unknown): asserts value is GetContactsOutput {
    assertSchema(
      value,
      {
        $defs: {
          RecipientContact: {
            properties: {
              full_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Full Name' },
              email: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Email' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: ['full_name', 'email', 'user_image'],
            title: 'RecipientContact',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/RecipientContact' },
        type: 'array',
      },
      'get_contacts output',
    )
  },
}

export const operationGetAddressBookContactCount: Validators<
  GetAddressBookContactCountInput,
  GetAddressBookContactCountOutput
> = {
  validateInput(value: unknown): asserts value is GetAddressBookContactCountInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          address_book: { title: 'Address Book', type: 'string' },
        },
        required: ['account', 'address_book'],
        additionalProperties: false,
        $defs: {},
      },
      'get_address_book_contact_count input',
    )
  },
  validateOutput(value: unknown): asserts value is GetAddressBookContactCountOutput {
    assertSchema(value, { type: 'integer' }, 'get_address_book_contact_count output')
  },
}

export const operationAddContactCard: Validators<AddContactCardInput, AddContactCardOutput> = {
  validateInput(value: unknown): asserts value is AddContactCardInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          address_book_ids: { items: { type: 'string' }, title: 'Address Book Ids', type: 'array' },
          full_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Full Name' },
          kind: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Kind' },
          emails: {
            anyOf: [{ items: { $ref: '#/$defs/Email' }, type: 'array' }, { type: 'null' }],
            title: 'Emails',
          },
          phones: {
            anyOf: [{ items: { $ref: '#/$defs/Phone' }, type: 'array' }, { type: 'null' }],
            title: 'Phones',
          },
          addresses: {
            anyOf: [{ items: { $ref: '#/$defs/PostalAddress' }, type: 'array' }, { type: 'null' }],
            title: 'Addresses',
          },
        },
        required: ['account', 'address_book_ids'],
        additionalProperties: false,
        $defs: {
          Email: {
            properties: {
              address: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Address' },
              type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Type' },
              label: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Label' },
              contexts: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Contexts' },
            },
            required: ['address'],
            title: 'Email',
            type: 'object',
          },
          Phone: {
            properties: {
              number: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Number' },
              type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Type' },
              label: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Label' },
              contexts: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Contexts' },
            },
            required: ['number'],
            title: 'Phone',
            type: 'object',
          },
          PostalAddress: {
            properties: {
              idx: { title: 'Idx', type: 'integer' },
              type: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Type' },
              street: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Street' },
              locality: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Locality' },
              region: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Region' },
              postcode: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Postcode' },
              country: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Country' },
              time_zone: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Time Zone' },
              contexts: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Contexts' },
            },
            title: 'PostalAddress',
            type: 'object',
          },
        },
      },
      'add_contact_card input',
    )
  },
  validateOutput(value: unknown): asserts value is AddContactCardOutput {
    assertSchema(value, { type: 'string' }, 'add_contact_card output')
  },
}

export const operationDeleteContactCards: Validators<
  DeleteContactCardsInput,
  DeleteContactCardsOutput
> = {
  validateInput(value: unknown): asserts value is DeleteContactCardsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
        },
        required: ['account', 'ids'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_contact_cards input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteContactCardsOutput {
    assertSchema(value, { type: 'null' }, 'delete_contact_cards output')
  },
}

export const operationContactCardAddToAddressBook: Validators<
  ContactCardAddToAddressBookInput,
  ContactCardAddToAddressBookOutput
> = {
  validateInput(value: unknown): asserts value is ContactCardAddToAddressBookInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
          address_book_id: { title: 'Address Book Id', type: 'string' },
        },
        required: ['account', 'ids', 'address_book_id'],
        additionalProperties: false,
        $defs: {},
      },
      'contact_card_add_to_address_book input',
    )
  },
  validateOutput(value: unknown): asserts value is ContactCardAddToAddressBookOutput {
    assertSchema(value, { type: 'null' }, 'contact_card_add_to_address_book output')
  },
}

export const operationContactCardRemoveFromAddressBook: Validators<
  ContactCardRemoveFromAddressBookInput,
  ContactCardRemoveFromAddressBookOutput
> = {
  validateInput(value: unknown): asserts value is ContactCardRemoveFromAddressBookInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
          address_book_id: { title: 'Address Book Id', type: 'string' },
        },
        required: ['account', 'ids', 'address_book_id'],
        additionalProperties: false,
        $defs: {},
      },
      'contact_card_remove_from_address_book input',
    )
  },
  validateOutput(value: unknown): asserts value is ContactCardRemoveFromAddressBookOutput {
    assertSchema(value, { type: 'null' }, 'contact_card_remove_from_address_book output')
  },
}

export const operationAddAddressBook: Validators<AddAddressBookInput, AddAddressBookOutput> = {
  validateInput(value: unknown): asserts value is AddAddressBookInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          name: { title: 'Name', type: 'string' },
          description: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Description' },
          sort_order: { title: 'Sort Order', type: 'integer' },
          default: { type: 'boolean', title: 'Default' },
          subscribed: { title: 'Subscribed', type: 'boolean' },
        },
        required: ['account', 'name'],
        additionalProperties: false,
        $defs: {},
      },
      'add_address_book input',
    )
  },
  validateOutput(value: unknown): asserts value is AddAddressBookOutput {
    assertSchema(value, { type: 'string' }, 'add_address_book output')
  },
}

export const operationDeleteAddressBooks: Validators<
  DeleteAddressBooksInput,
  DeleteAddressBooksOutput
> = {
  validateInput(value: unknown): asserts value is DeleteAddressBooksInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
        },
        required: ['account', 'ids'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_address_books input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteAddressBooksOutput {
    assertSchema(value, { type: 'null' }, 'delete_address_books output')
  },
}

export const operationGetThreads: Validators<GetThreadsInput, GetThreadsOutput> = {
  validateInput(value: unknown): asserts value is GetThreadsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          limit: { title: 'Limit', type: 'integer' },
          start: { title: 'Start', type: 'integer' },
          filter_by: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Filter By' },
          mailbox: { title: 'Mailbox', type: 'string' },
        },
        required: ['account', 'limit', 'mailbox'],
        additionalProperties: false,
        $defs: {},
      },
      'get_threads input',
    )
  },
  validateOutput(value: unknown): asserts value is GetThreadsOutput {
    assertSchema(
      value,
      {
        $defs: {
          Attachment: {
            properties: {
              filename: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Filename' },
              type: { title: 'Type', type: 'string' },
              size: { title: 'Size', type: 'integer' },
              blob_id: { title: 'Blob Id', type: 'string' },
              disposition: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Disposition' },
              cid: { title: 'Cid', type: 'string' },
              url: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Url' },
              part_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Part Id' },
              charset: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Charset' },
              language: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Language' },
              location: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Location' },
            },
            required: ['filename', 'type', 'size', 'blob_id', 'disposition', 'cid', 'url'],
            title: 'Attachment',
            type: 'object',
          },
          Copy: {
            properties: {
              name: { title: 'Name', type: 'string' },
              id: { title: 'Id', type: 'string' },
              thread_id: { title: 'Thread Id', type: 'string' },
              from_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Name' },
              from_email: { title: 'From Email', type: 'string' },
              received_at: { title: 'Received At', type: 'string' },
              mailboxes: {
                items: { $ref: '#/$defs/MailboxRef' },
                title: 'Mailboxes',
                type: 'array',
              },
              seen: { enum: [0, 1], title: 'Seen', type: 'integer' },
              junk: { enum: [0, 1], title: 'Junk', type: 'integer' },
              flagged: { enum: [0, 1], title: 'Flagged', type: 'integer' },
              draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
              unscreened: { enum: [0, 1], title: 'Unscreened', type: 'integer' },
            },
            required: [
              'name',
              'id',
              'thread_id',
              'from_name',
              'from_email',
              'received_at',
              'mailboxes',
              'seen',
              'junk',
              'flagged',
              'draft',
            ],
            title: 'Copy',
            type: 'object',
          },
          MailboxRef: {
            properties: {
              mailbox: { title: 'Mailbox', type: 'string' },
              mailbox_id: { title: 'Mailbox Id', type: 'string' },
              mailbox_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Mailbox Name',
              },
            },
            required: ['mailbox', 'mailbox_id', 'mailbox_name'],
            title: 'MailboxRef',
            type: 'object',
          },
          Message: {
            properties: {
              name: { title: 'Name', type: 'string' },
              id: { title: 'Id', type: 'string' },
              thread_id: { title: 'Thread Id', type: 'string' },
              from_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Name' },
              from_email: { title: 'From Email', type: 'string' },
              received_at: { title: 'Received At', type: 'string' },
              mailboxes: {
                items: { $ref: '#/$defs/MailboxRef' },
                title: 'Mailboxes',
                type: 'array',
              },
              seen: { enum: [0, 1], title: 'Seen', type: 'integer' },
              junk: { enum: [0, 1], title: 'Junk', type: 'integer' },
              flagged: { enum: [0, 1], title: 'Flagged', type: 'integer' },
              draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
              unscreened: { enum: [0, 1], title: 'Unscreened', type: 'integer' },
              message_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Message Id' },
              subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
              html_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Html Body' },
              text_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Text Body' },
              preview: { title: 'Preview', type: 'string' },
              recipients: {
                items: { $ref: '#/$defs/Recipient' },
                title: 'Recipients',
                type: 'array',
              },
              reply_to: {
                items: { $ref: '#/$defs/ReplyAddress' },
                title: 'Reply To',
                type: 'array',
              },
              attachments: {
                items: { $ref: '#/$defs/Attachment' },
                title: 'Attachments',
                type: 'array',
              },
              dsn_blob_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Dsn Blob Id' },
              duplicates: { items: { $ref: '#/$defs/Copy' }, title: 'Duplicates', type: 'array' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: [
              'name',
              'id',
              'thread_id',
              'from_name',
              'from_email',
              'received_at',
              'mailboxes',
              'seen',
              'junk',
              'flagged',
              'draft',
              'message_id',
              'subject',
              'html_body',
              'text_body',
              'preview',
              'recipients',
              'reply_to',
              'attachments',
              'dsn_blob_id',
            ],
            title: 'Message',
            type: 'object',
          },
          Recipient: {
            properties: {
              type: { enum: ['To', 'Cc', 'Bcc'], title: 'Type', type: 'string' },
              email: { title: 'Email', type: 'string' },
              display_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Display Name',
              },
            },
            required: ['type', 'email', 'display_name'],
            title: 'Recipient',
            type: 'object',
          },
          ReplyAddress: {
            properties: {
              email: { title: 'Email', type: 'string' },
              display_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Display Name',
              },
            },
            required: ['email', 'display_name'],
            title: 'ReplyAddress',
            type: 'object',
          },
          Thread: {
            properties: {
              name: { title: 'Name', type: 'string' },
              id: { title: 'Id', type: 'string' },
              thread_id: { title: 'Thread Id', type: 'string' },
              from_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Name' },
              from_email: { title: 'From Email', type: 'string' },
              received_at: { title: 'Received At', type: 'string' },
              mailboxes: {
                items: { $ref: '#/$defs/MailboxRef' },
                title: 'Mailboxes',
                type: 'array',
              },
              seen: { enum: [0, 1], title: 'Seen', type: 'integer' },
              junk: { enum: [0, 1], title: 'Junk', type: 'integer' },
              flagged: { enum: [0, 1], title: 'Flagged', type: 'integer' },
              draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
              unscreened: { enum: [0, 1], title: 'Unscreened', type: 'integer' },
              account: { title: 'Account', type: 'string' },
              account_name: { title: 'Account Name', type: 'string' },
              view_mailbox: { title: 'View Mailbox', type: 'string' },
              inbox: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Inbox' },
              archive: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Archive' },
              trash: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Trash' },
              unscreened_senders: {
                items: { type: 'string' },
                title: 'Unscreened Senders',
                type: 'array',
              },
              subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
              preview: { title: 'Preview', type: 'string' },
              recipients: {
                items: { $ref: '#/$defs/Recipient' },
                title: 'Recipients',
                type: 'array',
              },
              attachments: {
                items: { $ref: '#/$defs/Attachment' },
                title: 'Attachments',
                type: 'array',
              },
              messages: { items: { $ref: '#/$defs/Message' }, title: 'Messages', type: 'array' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: [
              'name',
              'id',
              'thread_id',
              'from_name',
              'from_email',
              'received_at',
              'mailboxes',
              'seen',
              'junk',
              'flagged',
              'draft',
              'subject',
              'preview',
              'recipients',
              'attachments',
              'messages',
            ],
            title: 'Thread',
            type: 'object',
          },
        },
        properties: {
          rows: { items: { $ref: '#/$defs/Thread' }, title: 'Rows', type: 'array' },
          mailbox: { title: 'Mailbox', type: 'string' },
          has_more: { title: 'Has More', type: 'boolean' },
        },
        required: ['rows', 'mailbox', 'has_more'],
        title: 'ThreadPage',
        type: 'object',
      },
      'get_threads output',
    )
  },
}

export const operationGetUnifiedThreads: Validators<
  GetUnifiedThreadsInput,
  GetUnifiedThreadsOutput
> = {
  validateInput(value: unknown): asserts value is GetUnifiedThreadsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          limit: { title: 'Limit', type: 'integer' },
          start: { title: 'Start', type: 'integer' },
          filter_by: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Filter By' },
          folder: { title: 'Folder', type: 'string' },
        },
        required: ['limit', 'folder'],
        additionalProperties: false,
        $defs: {},
      },
      'get_unified_threads input',
    )
  },
  validateOutput(value: unknown): asserts value is GetUnifiedThreadsOutput {
    assertSchema(
      value,
      {
        $defs: {
          Attachment: {
            properties: {
              filename: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Filename' },
              type: { title: 'Type', type: 'string' },
              size: { title: 'Size', type: 'integer' },
              blob_id: { title: 'Blob Id', type: 'string' },
              disposition: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Disposition' },
              cid: { title: 'Cid', type: 'string' },
              url: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Url' },
              part_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Part Id' },
              charset: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Charset' },
              language: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Language' },
              location: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Location' },
            },
            required: ['filename', 'type', 'size', 'blob_id', 'disposition', 'cid', 'url'],
            title: 'Attachment',
            type: 'object',
          },
          Copy: {
            properties: {
              name: { title: 'Name', type: 'string' },
              id: { title: 'Id', type: 'string' },
              thread_id: { title: 'Thread Id', type: 'string' },
              from_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Name' },
              from_email: { title: 'From Email', type: 'string' },
              received_at: { title: 'Received At', type: 'string' },
              mailboxes: {
                items: { $ref: '#/$defs/MailboxRef' },
                title: 'Mailboxes',
                type: 'array',
              },
              seen: { enum: [0, 1], title: 'Seen', type: 'integer' },
              junk: { enum: [0, 1], title: 'Junk', type: 'integer' },
              flagged: { enum: [0, 1], title: 'Flagged', type: 'integer' },
              draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
              unscreened: { enum: [0, 1], title: 'Unscreened', type: 'integer' },
            },
            required: [
              'name',
              'id',
              'thread_id',
              'from_name',
              'from_email',
              'received_at',
              'mailboxes',
              'seen',
              'junk',
              'flagged',
              'draft',
            ],
            title: 'Copy',
            type: 'object',
          },
          MailboxRef: {
            properties: {
              mailbox: { title: 'Mailbox', type: 'string' },
              mailbox_id: { title: 'Mailbox Id', type: 'string' },
              mailbox_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Mailbox Name',
              },
            },
            required: ['mailbox', 'mailbox_id', 'mailbox_name'],
            title: 'MailboxRef',
            type: 'object',
          },
          Message: {
            properties: {
              name: { title: 'Name', type: 'string' },
              id: { title: 'Id', type: 'string' },
              thread_id: { title: 'Thread Id', type: 'string' },
              from_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Name' },
              from_email: { title: 'From Email', type: 'string' },
              received_at: { title: 'Received At', type: 'string' },
              mailboxes: {
                items: { $ref: '#/$defs/MailboxRef' },
                title: 'Mailboxes',
                type: 'array',
              },
              seen: { enum: [0, 1], title: 'Seen', type: 'integer' },
              junk: { enum: [0, 1], title: 'Junk', type: 'integer' },
              flagged: { enum: [0, 1], title: 'Flagged', type: 'integer' },
              draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
              unscreened: { enum: [0, 1], title: 'Unscreened', type: 'integer' },
              message_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Message Id' },
              subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
              html_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Html Body' },
              text_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Text Body' },
              preview: { title: 'Preview', type: 'string' },
              recipients: {
                items: { $ref: '#/$defs/Recipient' },
                title: 'Recipients',
                type: 'array',
              },
              reply_to: {
                items: { $ref: '#/$defs/ReplyAddress' },
                title: 'Reply To',
                type: 'array',
              },
              attachments: {
                items: { $ref: '#/$defs/Attachment' },
                title: 'Attachments',
                type: 'array',
              },
              dsn_blob_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Dsn Blob Id' },
              duplicates: { items: { $ref: '#/$defs/Copy' }, title: 'Duplicates', type: 'array' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: [
              'name',
              'id',
              'thread_id',
              'from_name',
              'from_email',
              'received_at',
              'mailboxes',
              'seen',
              'junk',
              'flagged',
              'draft',
              'message_id',
              'subject',
              'html_body',
              'text_body',
              'preview',
              'recipients',
              'reply_to',
              'attachments',
              'dsn_blob_id',
            ],
            title: 'Message',
            type: 'object',
          },
          Recipient: {
            properties: {
              type: { enum: ['To', 'Cc', 'Bcc'], title: 'Type', type: 'string' },
              email: { title: 'Email', type: 'string' },
              display_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Display Name',
              },
            },
            required: ['type', 'email', 'display_name'],
            title: 'Recipient',
            type: 'object',
          },
          ReplyAddress: {
            properties: {
              email: { title: 'Email', type: 'string' },
              display_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Display Name',
              },
            },
            required: ['email', 'display_name'],
            title: 'ReplyAddress',
            type: 'object',
          },
          Thread: {
            properties: {
              name: { title: 'Name', type: 'string' },
              id: { title: 'Id', type: 'string' },
              thread_id: { title: 'Thread Id', type: 'string' },
              from_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Name' },
              from_email: { title: 'From Email', type: 'string' },
              received_at: { title: 'Received At', type: 'string' },
              mailboxes: {
                items: { $ref: '#/$defs/MailboxRef' },
                title: 'Mailboxes',
                type: 'array',
              },
              seen: { enum: [0, 1], title: 'Seen', type: 'integer' },
              junk: { enum: [0, 1], title: 'Junk', type: 'integer' },
              flagged: { enum: [0, 1], title: 'Flagged', type: 'integer' },
              draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
              unscreened: { enum: [0, 1], title: 'Unscreened', type: 'integer' },
              account: { title: 'Account', type: 'string' },
              account_name: { title: 'Account Name', type: 'string' },
              view_mailbox: { title: 'View Mailbox', type: 'string' },
              inbox: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Inbox' },
              archive: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Archive' },
              trash: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Trash' },
              unscreened_senders: {
                items: { type: 'string' },
                title: 'Unscreened Senders',
                type: 'array',
              },
              subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
              preview: { title: 'Preview', type: 'string' },
              recipients: {
                items: { $ref: '#/$defs/Recipient' },
                title: 'Recipients',
                type: 'array',
              },
              attachments: {
                items: { $ref: '#/$defs/Attachment' },
                title: 'Attachments',
                type: 'array',
              },
              messages: { items: { $ref: '#/$defs/Message' }, title: 'Messages', type: 'array' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: [
              'name',
              'id',
              'thread_id',
              'from_name',
              'from_email',
              'received_at',
              'mailboxes',
              'seen',
              'junk',
              'flagged',
              'draft',
              'subject',
              'preview',
              'recipients',
              'attachments',
              'messages',
            ],
            title: 'Thread',
            type: 'object',
          },
        },
        properties: {
          rows: { items: { $ref: '#/$defs/Thread' }, title: 'Rows', type: 'array' },
          has_more: { title: 'Has More', type: 'boolean' },
        },
        required: ['rows', 'has_more'],
        title: 'UnifiedThreadPage',
        type: 'object',
      },
      'get_unified_threads output',
    )
  },
}

export const operationGetThread: Validators<GetThreadInput, GetThreadOutput> = {
  validateInput(value: unknown): asserts value is GetThreadInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          thread_id: { title: 'Thread Id', type: 'string' },
        },
        required: ['account', 'thread_id'],
        additionalProperties: false,
        $defs: {},
      },
      'get_thread input',
    )
  },
  validateOutput(value: unknown): asserts value is GetThreadOutput {
    assertSchema(
      value,
      {
        $defs: {
          Attachment: {
            properties: {
              filename: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Filename' },
              type: { title: 'Type', type: 'string' },
              size: { title: 'Size', type: 'integer' },
              blob_id: { title: 'Blob Id', type: 'string' },
              disposition: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Disposition' },
              cid: { title: 'Cid', type: 'string' },
              url: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Url' },
              part_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Part Id' },
              charset: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Charset' },
              language: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Language' },
              location: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Location' },
            },
            required: ['filename', 'type', 'size', 'blob_id', 'disposition', 'cid', 'url'],
            title: 'Attachment',
            type: 'object',
          },
          Copy: {
            properties: {
              name: { title: 'Name', type: 'string' },
              id: { title: 'Id', type: 'string' },
              thread_id: { title: 'Thread Id', type: 'string' },
              from_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Name' },
              from_email: { title: 'From Email', type: 'string' },
              received_at: { title: 'Received At', type: 'string' },
              mailboxes: {
                items: { $ref: '#/$defs/MailboxRef' },
                title: 'Mailboxes',
                type: 'array',
              },
              seen: { enum: [0, 1], title: 'Seen', type: 'integer' },
              junk: { enum: [0, 1], title: 'Junk', type: 'integer' },
              flagged: { enum: [0, 1], title: 'Flagged', type: 'integer' },
              draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
              unscreened: { enum: [0, 1], title: 'Unscreened', type: 'integer' },
            },
            required: [
              'name',
              'id',
              'thread_id',
              'from_name',
              'from_email',
              'received_at',
              'mailboxes',
              'seen',
              'junk',
              'flagged',
              'draft',
            ],
            title: 'Copy',
            type: 'object',
          },
          MailboxRef: {
            properties: {
              mailbox: { title: 'Mailbox', type: 'string' },
              mailbox_id: { title: 'Mailbox Id', type: 'string' },
              mailbox_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Mailbox Name',
              },
            },
            required: ['mailbox', 'mailbox_id', 'mailbox_name'],
            title: 'MailboxRef',
            type: 'object',
          },
          Message: {
            properties: {
              name: { title: 'Name', type: 'string' },
              id: { title: 'Id', type: 'string' },
              thread_id: { title: 'Thread Id', type: 'string' },
              from_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Name' },
              from_email: { title: 'From Email', type: 'string' },
              received_at: { title: 'Received At', type: 'string' },
              mailboxes: {
                items: { $ref: '#/$defs/MailboxRef' },
                title: 'Mailboxes',
                type: 'array',
              },
              seen: { enum: [0, 1], title: 'Seen', type: 'integer' },
              junk: { enum: [0, 1], title: 'Junk', type: 'integer' },
              flagged: { enum: [0, 1], title: 'Flagged', type: 'integer' },
              draft: { enum: [0, 1], title: 'Draft', type: 'integer' },
              unscreened: { enum: [0, 1], title: 'Unscreened', type: 'integer' },
              message_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Message Id' },
              subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
              html_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Html Body' },
              text_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Text Body' },
              preview: { title: 'Preview', type: 'string' },
              recipients: {
                items: { $ref: '#/$defs/Recipient' },
                title: 'Recipients',
                type: 'array',
              },
              reply_to: {
                items: { $ref: '#/$defs/ReplyAddress' },
                title: 'Reply To',
                type: 'array',
              },
              attachments: {
                items: { $ref: '#/$defs/Attachment' },
                title: 'Attachments',
                type: 'array',
              },
              dsn_blob_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Dsn Blob Id' },
              duplicates: { items: { $ref: '#/$defs/Copy' }, title: 'Duplicates', type: 'array' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: [
              'name',
              'id',
              'thread_id',
              'from_name',
              'from_email',
              'received_at',
              'mailboxes',
              'seen',
              'junk',
              'flagged',
              'draft',
              'message_id',
              'subject',
              'html_body',
              'text_body',
              'preview',
              'recipients',
              'reply_to',
              'attachments',
              'dsn_blob_id',
            ],
            title: 'Message',
            type: 'object',
          },
          Recipient: {
            properties: {
              type: { enum: ['To', 'Cc', 'Bcc'], title: 'Type', type: 'string' },
              email: { title: 'Email', type: 'string' },
              display_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Display Name',
              },
            },
            required: ['type', 'email', 'display_name'],
            title: 'Recipient',
            type: 'object',
          },
          ReplyAddress: {
            properties: {
              email: { title: 'Email', type: 'string' },
              display_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Display Name',
              },
            },
            required: ['email', 'display_name'],
            title: 'ReplyAddress',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/Message' },
        type: 'array',
      },
      'get_thread output',
    )
  },
}

export const operationSearchMails: Validators<SearchMailsInput, SearchMailsOutput> = {
  validateInput(value: unknown): asserts value is SearchMailsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          filter: { anyOf: [{ $ref: '#/$defs/SearchFilter' }, { type: 'null' }] },
          limit: { title: 'Limit', type: 'integer' },
          start: { title: 'Start', type: 'integer' },
          all_accounts: { title: 'All Accounts', type: 'boolean' },
        },
        required: ['account'],
        additionalProperties: false,
        $defs: {
          SearchFilter: {
            properties: {
              text: { title: 'Text', type: 'string' },
              from: { title: 'From', type: 'string' },
              to: { title: 'To', type: 'string' },
              cc: { title: 'Cc', type: 'string' },
              bcc: { title: 'Bcc', type: 'string' },
              subject: { title: 'Subject', type: 'string' },
              body: { title: 'Body', type: 'string' },
              before: { title: 'Before', type: 'string' },
              after: { title: 'After', type: 'string' },
              inMailbox: { title: 'Inmailbox', type: 'string' },
              inMailboxOtherThan: {
                items: { type: 'string' },
                title: 'Inmailboxotherthan',
                type: 'array',
              },
              hasAttachment: {
                anyOf: [{ type: 'boolean' }, { type: 'string' }],
                title: 'Hasattachment',
              },
              isRead: { anyOf: [{ type: 'boolean' }, { type: 'string' }], title: 'Isread' },
              hasKeyword: { title: 'Haskeyword', type: 'string' },
              notKeyword: { title: 'Notkeyword', type: 'string' },
              someInThreadHaveKeyword: { title: 'Someinthreadhavekeyword', type: 'string' },
              minSize: { title: 'Minsize', type: 'integer' },
              maxSize: { title: 'Maxsize', type: 'integer' },
              operator: { title: 'Operator', type: 'string' },
              conditions: {
                items: { $ref: '#/$defs/SearchFilter' },
                title: 'Conditions',
                type: 'array',
              },
              all_accounts: {
                anyOf: [{ type: 'string' }, { type: 'boolean' }],
                title: 'All Accounts',
              },
            },
            title: 'SearchFilter',
            type: 'object',
          },
        },
      },
      'search_mails input',
    )
  },
  validateOutput(value: unknown): asserts value is SearchMailsOutput {
    assertSchema(
      value,
      {
        $defs: {
          Attachment: {
            properties: {
              filename: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Filename' },
              type: { title: 'Type', type: 'string' },
              size: { title: 'Size', type: 'integer' },
              blob_id: { title: 'Blob Id', type: 'string' },
              disposition: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Disposition' },
              cid: { title: 'Cid', type: 'string' },
              url: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Url' },
              part_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Part Id' },
              charset: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Charset' },
              language: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Language' },
              location: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Location' },
            },
            required: ['filename', 'type', 'size', 'blob_id', 'disposition', 'cid', 'url'],
            title: 'Attachment',
            type: 'object',
          },
          MailboxRef: {
            properties: {
              mailbox: { title: 'Mailbox', type: 'string' },
              mailbox_id: { title: 'Mailbox Id', type: 'string' },
              mailbox_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Mailbox Name',
              },
            },
            required: ['mailbox', 'mailbox_id', 'mailbox_name'],
            title: 'MailboxRef',
            type: 'object',
          },
          Recipient: {
            properties: {
              type: { enum: ['To', 'Cc', 'Bcc'], title: 'Type', type: 'string' },
              email: { title: 'Email', type: 'string' },
              display_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Display Name',
              },
            },
            required: ['type', 'email', 'display_name'],
            title: 'Recipient',
            type: 'object',
          },
          SearchRow: {
            properties: {
              account: { title: 'Account', type: 'string' },
              account_name: { title: 'Account Name', type: 'string' },
              view_mailbox: { title: 'View Mailbox', type: 'string' },
              inbox: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Inbox' },
              archive: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Archive' },
              trash: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Trash' },
              name: { title: 'Name', type: 'string' },
              id: { title: 'Id', type: 'string' },
              subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
              preview: { title: 'Preview', type: 'string' },
              recipients: {
                items: { $ref: '#/$defs/Recipient' },
                title: 'Recipients',
                type: 'array',
              },
              sent_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Sent At' },
              received_at: { title: 'Received At', type: 'string' },
              from_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Name' },
              from_email: { title: 'From Email', type: 'string' },
              thread_id: { title: 'Thread Id', type: 'string' },
              mailboxes: {
                items: { $ref: '#/$defs/MailboxRef' },
                title: 'Mailboxes',
                type: 'array',
              },
              attachments: {
                items: { $ref: '#/$defs/Attachment' },
                title: 'Attachments',
                type: 'array',
              },
              seen: { enum: [0, 1], title: 'Seen', type: 'integer' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: [
              'name',
              'id',
              'subject',
              'preview',
              'recipients',
              'sent_at',
              'received_at',
              'from_name',
              'from_email',
              'thread_id',
              'mailboxes',
              'attachments',
              'seen',
            ],
            title: 'SearchRow',
            type: 'object',
          },
        },
        properties: {
          rows: { items: { $ref: '#/$defs/SearchRow' }, title: 'Rows', type: 'array' },
          total: { title: 'Total', type: 'integer' },
        },
        required: ['rows', 'total'],
        title: 'SearchPage',
        type: 'object',
      },
      'search_mails output',
    )
  },
}

export const operationGetMimeMessage: Validators<GetMimeMessageInput, GetMimeMessageOutput> = {
  validateInput(value: unknown): asserts value is GetMimeMessageInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { title: 'Name', type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'get_mime_message input',
    )
  },
  validateOutput(value: unknown): asserts value is GetMimeMessageOutput {
    assertSchema(
      value,
      {
        $defs: {
          MimeField: {
            properties: {
              label: { title: 'Label', type: 'string' },
              value: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Value' },
              description: { title: 'Description', type: 'string' },
            },
            required: ['label', 'value'],
            title: 'MimeField',
            type: 'object',
          },
        },
        properties: {
          message: { title: 'Message', type: 'string' },
          message_id: { $ref: '#/$defs/MimeField' },
          created_at: { $ref: '#/$defs/MimeField' },
          subject: { $ref: '#/$defs/MimeField' },
          from: { $ref: '#/$defs/MimeField' },
          to: { $ref: '#/$defs/MimeField' },
          cc: { $ref: '#/$defs/MimeField' },
          bcc: { $ref: '#/$defs/MimeField' },
          spf: { $ref: '#/$defs/MimeField' },
          dkim: { $ref: '#/$defs/MimeField' },
          dmarc: { $ref: '#/$defs/MimeField' },
        },
        required: ['message', 'message_id', 'created_at', 'subject', 'from', 'to', 'cc', 'bcc'],
        title: 'MimeMessage',
        type: 'object',
      },
      'get_mime_message output',
    )
  },
}

export const operationGetDeliveryStatus: Validators<
  GetDeliveryStatusInput,
  GetDeliveryStatusOutput
> = {
  validateInput(value: unknown): asserts value is GetDeliveryStatusInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          blob_id: { title: 'Blob Id', type: 'string' },
        },
        required: ['account', 'blob_id'],
        additionalProperties: false,
        $defs: {},
      },
      'get_delivery_status input',
    )
  },
  validateOutput(value: unknown): asserts value is GetDeliveryStatusOutput {
    assertSchema(
      value,
      {
        $defs: {
          DeliveryRecipient: {
            properties: {
              email: { title: 'Email', type: 'string' },
              action: { title: 'Action', type: 'string' },
              status: { title: 'Status', type: 'string' },
              diagnostic_code: { title: 'Diagnostic Code', type: 'string' },
              remote_mta: { title: 'Remote Mta', type: 'string' },
              will_retry_until: { title: 'Will Retry Until', type: 'string' },
            },
            required: [
              'email',
              'action',
              'status',
              'diagnostic_code',
              'remote_mta',
              'will_retry_until',
            ],
            title: 'DeliveryRecipient',
            type: 'object',
          },
        },
        properties: {
          reporting_mta: { title: 'Reporting Mta', type: 'string' },
          arrival_date: { title: 'Arrival Date', type: 'string' },
          recipients: {
            items: { $ref: '#/$defs/DeliveryRecipient' },
            title: 'Recipients',
            type: 'array',
          },
        },
        required: ['reporting_mta', 'arrival_date', 'recipients'],
        title: 'DeliveryReport',
        type: 'object',
      },
      'get_delivery_status output',
    )
  },
}

export const operationCreateMail: Validators<CreateMailInput, CreateMailOutput> = {
  validateInput(value: unknown): asserts value is CreateMailInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          from_email: { title: 'From Email', type: 'string' },
          to: { items: { $ref: '#/$defs/RecipientInput' }, title: 'To', type: 'array' },
          cc: { items: { $ref: '#/$defs/RecipientInput' }, title: 'Cc', type: 'array' },
          bcc: { items: { $ref: '#/$defs/RecipientInput' }, title: 'Bcc', type: 'array' },
          subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
          html_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Html Body' },
          from_name: { title: 'From Name', type: 'string' },
          attachments: {
            anyOf: [
              { items: { $ref: '#/$defs/DraftAttachment' }, type: 'array' },
              { type: 'null' },
            ],
            title: 'Attachments',
          },
          send_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Send At' },
          undo_send: { title: 'Undo Send', type: 'boolean' },
          in_reply_to: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'In Reply To' },
          in_reply_to_id: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'In Reply To Id',
          },
          forwarded_from_id: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Forwarded From Id',
          },
          save_as_draft: { title: 'Save As Draft', type: 'boolean' },
        },
        required: ['account', 'from_email', 'to', 'cc', 'bcc', 'subject', 'html_body'],
        additionalProperties: false,
        $defs: {
          DraftAttachment: {
            properties: {
              filename: { title: 'Filename', type: 'string' },
              file_url: { title: 'File Url', type: 'string' },
              blob_id: { title: 'Blob Id', type: 'string' },
              type: { title: 'Type', type: 'string' },
              size: { anyOf: [{ type: 'integer' }, { type: 'string' }], title: 'Size' },
              disposition: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Disposition' },
              cid: { title: 'Cid', type: 'string' },
            },
            title: 'DraftAttachment',
            type: 'object',
          },
          RecipientInput: {
            properties: {
              email: { title: 'Email', type: 'string' },
              display_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Display Name',
              },
            },
            required: ['email'],
            title: 'RecipientInput',
            type: 'object',
          },
        },
      },
      'create_mail input',
    )
  },
  validateOutput(value: unknown): asserts value is CreateMailOutput {
    assertSchema(
      value,
      {
        properties: {
          name: { title: 'Name', type: 'string' },
          id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Id' },
          status: { title: 'Status', type: 'string' },
          error: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Error' },
          thread_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Thread Id' },
          submission_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Submission Id' },
          send_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Send At' },
          undo_send_period: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Undo Send Period',
          },
        },
        required: [
          'name',
          'id',
          'status',
          'error',
          'thread_id',
          'submission_id',
          'send_at',
          'undo_send_period',
        ],
        title: 'DraftResult',
        type: 'object',
      },
      'create_mail output',
    )
  },
}

export const operationUpdateDraftMail: Validators<UpdateDraftMailInput, UpdateDraftMailOutput> = {
  validateInput(value: unknown): asserts value is UpdateDraftMailInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          from_email: { title: 'From Email', type: 'string' },
          to: { items: { $ref: '#/$defs/RecipientInput' }, title: 'To', type: 'array' },
          cc: { items: { $ref: '#/$defs/RecipientInput' }, title: 'Cc', type: 'array' },
          bcc: { items: { $ref: '#/$defs/RecipientInput' }, title: 'Bcc', type: 'array' },
          subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
          html_body: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Html Body' },
          from_name: { title: 'From Name', type: 'string' },
          attachments: {
            anyOf: [
              { items: { $ref: '#/$defs/DraftAttachment' }, type: 'array' },
              { type: 'null' },
            ],
            title: 'Attachments',
          },
          send_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Send At' },
          undo_send: { title: 'Undo Send', type: 'boolean' },
          id: { title: 'Id', type: 'string' },
          submit: { title: 'Submit', type: 'boolean' },
        },
        required: ['account', 'from_email', 'to', 'cc', 'bcc', 'subject', 'html_body', 'id'],
        additionalProperties: false,
        $defs: {
          DraftAttachment: {
            properties: {
              filename: { title: 'Filename', type: 'string' },
              file_url: { title: 'File Url', type: 'string' },
              blob_id: { title: 'Blob Id', type: 'string' },
              type: { title: 'Type', type: 'string' },
              size: { anyOf: [{ type: 'integer' }, { type: 'string' }], title: 'Size' },
              disposition: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Disposition' },
              cid: { title: 'Cid', type: 'string' },
            },
            title: 'DraftAttachment',
            type: 'object',
          },
          RecipientInput: {
            properties: {
              email: { title: 'Email', type: 'string' },
              display_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Display Name',
              },
            },
            required: ['email'],
            title: 'RecipientInput',
            type: 'object',
          },
        },
      },
      'update_draft_mail input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateDraftMailOutput {
    assertSchema(
      value,
      {
        properties: {
          name: { title: 'Name', type: 'string' },
          id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Id' },
          status: { title: 'Status', type: 'string' },
          error: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Error' },
          thread_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Thread Id' },
          submission_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Submission Id' },
          send_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Send At' },
          undo_send_period: {
            anyOf: [{ type: 'integer' }, { type: 'null' }],
            title: 'Undo Send Period',
          },
        },
        required: [
          'name',
          'id',
          'status',
          'error',
          'thread_id',
          'submission_id',
          'send_at',
          'undo_send_period',
        ],
        title: 'DraftResult',
        type: 'object',
      },
      'update_draft_mail output',
    )
  },
}

export const operationDeleteMail: Validators<DeleteMailInput, DeleteMailOutput> = {
  validateInput(value: unknown): asserts value is DeleteMailInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
        },
        required: ['account', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_mail input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteMailOutput {
    assertSchema(value, { type: 'null' }, 'delete_mail output')
  },
}

export const operationSetFlagged: Validators<SetFlaggedInput, SetFlaggedOutput> = {
  validateInput(value: unknown): asserts value is SetFlaggedInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
          flagged: { title: 'Flagged', type: 'boolean' },
        },
        required: ['account', 'ids', 'flagged'],
        additionalProperties: false,
        $defs: {},
      },
      'set_flagged input',
    )
  },
  validateOutput(value: unknown): asserts value is SetFlaggedOutput {
    assertSchema(
      value,
      {
        properties: {
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
          flagged: { title: 'Flagged', type: 'boolean' },
        },
        required: ['ids', 'flagged'],
        title: 'FlagResult',
        type: 'object',
      },
      'set_flagged output',
    )
  },
}

export const operationSetMailsSeen: Validators<SetMailsSeenInput, SetMailsSeenOutput> = {
  validateInput(value: unknown): asserts value is SetMailsSeenInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
          seen: { title: 'Seen', type: 'boolean' },
        },
        required: ['account', 'ids', 'seen'],
        additionalProperties: false,
        $defs: {},
      },
      'set_mails_seen input',
    )
  },
  validateOutput(value: unknown): asserts value is SetMailsSeenOutput {
    assertSchema(value, { items: { type: 'string' }, type: 'array' }, 'set_mails_seen output')
  },
}

export const operationMoveMails: Validators<MoveMailsInput, MoveMailsOutput> = {
  validateInput(value: unknown): asserts value is MoveMailsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
          mailbox: { title: 'Mailbox', type: 'string' },
          clear_junk: { title: 'Clear Junk', type: 'boolean' },
        },
        required: ['account', 'ids', 'mailbox'],
        additionalProperties: false,
        $defs: {},
      },
      'move_mails input',
    )
  },
  validateOutput(value: unknown): asserts value is MoveMailsOutput {
    assertSchema(value, { type: 'null' }, 'move_mails output')
  },
}

export const operationAddMailsToMailbox: Validators<
  AddMailsToMailboxInput,
  AddMailsToMailboxOutput
> = {
  validateInput(value: unknown): asserts value is AddMailsToMailboxInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
          mailbox_id: { title: 'Mailbox Id', type: 'string' },
        },
        required: ['account', 'ids', 'mailbox_id'],
        additionalProperties: false,
        $defs: {},
      },
      'add_mails_to_mailbox input',
    )
  },
  validateOutput(value: unknown): asserts value is AddMailsToMailboxOutput {
    assertSchema(value, { type: 'null' }, 'add_mails_to_mailbox output')
  },
}

export const operationRemoveMailsFromMailbox: Validators<
  RemoveMailsFromMailboxInput,
  RemoveMailsFromMailboxOutput
> = {
  validateInput(value: unknown): asserts value is RemoveMailsFromMailboxInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
          mailbox_id: { title: 'Mailbox Id', type: 'string' },
        },
        required: ['account', 'ids', 'mailbox_id'],
        additionalProperties: false,
        $defs: {},
      },
      'remove_mails_from_mailbox input',
    )
  },
  validateOutput(value: unknown): asserts value is RemoveMailsFromMailboxOutput {
    assertSchema(value, { type: 'null' }, 'remove_mails_from_mailbox output')
  },
}

export const operationSetMailsMailboxes: Validators<
  SetMailsMailboxesInput,
  SetMailsMailboxesOutput
> = {
  validateInput(value: unknown): asserts value is SetMailsMailboxesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          mails: { items: { $ref: '#/$defs/Membership' }, title: 'Mails', type: 'array' },
          screen_action: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Screen Action' },
        },
        required: ['account', 'mails'],
        additionalProperties: false,
        $defs: {
          Membership: {
            properties: {
              id: { title: 'Id', type: 'string' },
              mailbox_ids: { items: { type: 'string' }, title: 'Mailbox Ids', type: 'array' },
              junk: { title: 'Junk', type: 'integer' },
            },
            required: ['id', 'mailbox_ids', 'junk'],
            title: 'Membership',
            type: 'object',
          },
        },
      },
      'set_mails_mailboxes input',
    )
  },
  validateOutput(value: unknown): asserts value is SetMailsMailboxesOutput {
    assertSchema(value, { type: 'null' }, 'set_mails_mailboxes output')
  },
}

export const operationSetMailsSpamStatus: Validators<
  SetMailsSpamStatusInput,
  SetMailsSpamStatusOutput
> = {
  validateInput(value: unknown): asserts value is SetMailsSpamStatusInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
          spam: { title: 'Spam', type: 'boolean' },
          screen_action: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Screen Action' },
        },
        required: ['account', 'ids', 'spam'],
        additionalProperties: false,
        $defs: {},
      },
      'set_mails_spam_status input',
    )
  },
  validateOutput(value: unknown): asserts value is SetMailsSpamStatusOutput {
    assertSchema(
      value,
      { items: { type: 'string' }, type: 'array' },
      'set_mails_spam_status output',
    )
  },
}

export const operationEmptyUserMailbox: Validators<EmptyUserMailboxInput, EmptyUserMailboxOutput> =
  {
    validateInput(value: unknown): asserts value is EmptyUserMailboxInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: {
            account: { title: 'Account', type: 'string' },
            mailbox: { title: 'Mailbox', type: 'string' },
          },
          required: ['account', 'mailbox'],
          additionalProperties: false,
          $defs: {},
        },
        'empty_user_mailbox input',
      )
    },
    validateOutput(value: unknown): asserts value is EmptyUserMailboxOutput {
      assertSchema(value, { type: 'null' }, 'empty_user_mailbox output')
    },
  }

export const operationAllowScreeningSenders: Validators<
  AllowScreeningSendersInput,
  AllowScreeningSendersOutput
> = {
  validateInput(value: unknown): asserts value is AllowScreeningSendersInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          from_emails: { items: { type: 'string' }, title: 'From Emails', type: 'array' },
          destination: {
            enum: ['inbox', 'archive', 'trash'],
            title: 'Destination',
            type: 'string',
          },
        },
        required: ['account', 'from_emails'],
        additionalProperties: false,
        $defs: {},
      },
      'allow_screening_senders input',
    )
  },
  validateOutput(value: unknown): asserts value is AllowScreeningSendersOutput {
    assertSchema(
      value,
      { additionalProperties: { items: { type: 'string' }, type: 'array' }, type: 'object' },
      'allow_screening_senders output',
    )
  },
}

export const operationScreenOutSenders: Validators<ScreenOutSendersInput, ScreenOutSendersOutput> =
  {
    validateInput(value: unknown): asserts value is ScreenOutSendersInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: {
            account: { title: 'Account', type: 'string' },
            from_emails: { items: { type: 'string' }, title: 'From Emails', type: 'array' },
          },
          required: ['account', 'from_emails'],
          additionalProperties: false,
          $defs: {},
        },
        'screen_out_senders input',
      )
    },
    validateOutput(value: unknown): asserts value is ScreenOutSendersOutput {
      assertSchema(
        value,
        { additionalProperties: { items: { type: 'string' }, type: 'array' }, type: 'object' },
        'screen_out_senders output',
      )
    },
  }

export const operationUndoScreeningVerdict: Validators<
  UndoScreeningVerdictInput,
  UndoScreeningVerdictOutput
> = {
  validateInput(value: unknown): asserts value is UndoScreeningVerdictInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          from_emails: { items: { type: 'string' }, title: 'From Emails', type: 'array' },
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
        },
        required: ['account', 'from_emails', 'ids'],
        additionalProperties: false,
        $defs: {},
      },
      'undo_screening_verdict input',
    )
  },
  validateOutput(value: unknown): asserts value is UndoScreeningVerdictOutput {
    assertSchema(value, { type: 'null' }, 'undo_screening_verdict output')
  },
}

export const operationBlockSenders: Validators<BlockSendersInput, BlockSendersOutput> = {
  validateInput(value: unknown): asserts value is BlockSendersInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          from_emails: { items: { type: 'string' }, title: 'From Emails', type: 'array' },
          ids: { items: { type: 'string' }, title: 'Ids', type: 'array' },
        },
        required: ['account', 'from_emails'],
        additionalProperties: false,
        $defs: {},
      },
      'block_senders input',
    )
  },
  validateOutput(value: unknown): asserts value is BlockSendersOutput {
    assertSchema(
      value,
      {
        properties: { inbox: { title: 'Inbox', type: 'integer' } },
        required: ['inbox'],
        title: 'BlockResult',
        type: 'object',
      },
      'block_senders output',
    )
  },
}

export const operationJunkSendersInboxMail: Validators<
  JunkSendersInboxMailInput,
  JunkSendersInboxMailOutput
> = {
  validateInput(value: unknown): asserts value is JunkSendersInboxMailInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          from_emails: { items: { type: 'string' }, title: 'From Emails', type: 'array' },
        },
        required: ['account', 'from_emails'],
        additionalProperties: false,
        $defs: {},
      },
      'junk_senders_inbox_mail input',
    )
  },
  validateOutput(value: unknown): asserts value is JunkSendersInboxMailOutput {
    assertSchema(
      value,
      { items: { type: 'string' }, type: 'array' },
      'junk_senders_inbox_mail output',
    )
  },
}

export const operationGetSubmissions: Validators<GetSubmissionsInput, GetSubmissionsOutput> = {
  validateInput(value: unknown): asserts value is GetSubmissionsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          undo_status: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Undo Status' },
          identity_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Identity Id' },
          email_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Email Id' },
          thread_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Thread Id' },
          before: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Before' },
          after: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'After' },
          start: { title: 'Start', type: 'integer' },
          page_length: { title: 'Page Length', type: 'integer' },
        },
        required: ['account'],
        additionalProperties: false,
        $defs: {},
      },
      'get_submissions input',
    )
  },
  validateOutput(value: unknown): asserts value is GetSubmissionsOutput {
    assertSchema(
      value,
      {
        $defs: {
          DeliveryError: {
            properties: {
              email: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Email' },
              reason: { title: 'Reason', type: 'string' },
            },
            required: ['email', 'reason'],
            title: 'DeliveryError',
            type: 'object',
          },
          Recipient: {
            properties: {
              type: { enum: ['To', 'Cc', 'Bcc'], title: 'Type', type: 'string' },
              email: { title: 'Email', type: 'string' },
              display_name: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Display Name',
              },
            },
            required: ['type', 'email', 'display_name'],
            title: 'Recipient',
            type: 'object',
          },
          RecipientState: {
            properties: {
              email: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Email' },
              status: {
                enum: [
                  'failed',
                  'retrying',
                  'queued',
                  'scheduled',
                  'cancelled',
                  'sent',
                  'delivered',
                  'displayed',
                ],
                title: 'Status',
                type: 'string',
              },
              reason: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Reason' },
              smtp_reply: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Smtp Reply' },
              delivered: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Delivered' },
              displayed: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Displayed' },
              retries: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Retries' },
              next_retry: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Next Retry' },
            },
            required: [
              'email',
              'status',
              'reason',
              'smtp_reply',
              'delivered',
              'displayed',
              'retries',
              'next_retry',
            ],
            title: 'RecipientState',
            type: 'object',
          },
          Submission: {
            properties: {
              id: { title: 'Id', type: 'string' },
              email_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Email Id' },
              thread_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Thread Id' },
              send_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Send At' },
              undo_status: {
                anyOf: [
                  { enum: ['pending', 'final', 'canceled'], type: 'string' },
                  { type: 'null' },
                ],
                title: 'Undo Status',
              },
              status: {
                enum: [
                  'failed',
                  'retrying',
                  'queued',
                  'scheduled',
                  'cancelled',
                  'sent',
                  'delivered',
                  'displayed',
                ],
                title: 'Status',
                type: 'string',
              },
              retries: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Retries' },
              recipients_status: {
                items: { $ref: '#/$defs/RecipientState' },
                title: 'Recipients Status',
                type: 'array',
              },
              delivery_errors: {
                items: { $ref: '#/$defs/DeliveryError' },
                title: 'Delivery Errors',
                type: 'array',
              },
              subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
              from_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Name' },
              from_email: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Email' },
              recipients: {
                items: { $ref: '#/$defs/Recipient' },
                title: 'Recipients',
                type: 'array',
              },
              email_deleted: { title: 'Email Deleted', type: 'boolean' },
            },
            required: [
              'id',
              'email_id',
              'thread_id',
              'send_at',
              'undo_status',
              'status',
              'retries',
              'recipients_status',
              'delivery_errors',
              'subject',
              'from_name',
              'from_email',
              'recipients',
              'email_deleted',
            ],
            title: 'Submission',
            type: 'object',
          },
        },
        properties: {
          rows: { items: { $ref: '#/$defs/Submission' }, title: 'Rows', type: 'array' },
          total: { title: 'Total', type: 'integer' },
        },
        required: ['rows', 'total'],
        title: 'SubmissionPage',
        type: 'object',
      },
      'get_submissions output',
    )
  },
}

export const operationGetScheduledMail: Validators<GetScheduledMailInput, GetScheduledMailOutput> =
  {
    validateInput(value: unknown): asserts value is GetScheduledMailInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: {
            account: { title: 'Account', type: 'string' },
            id: { title: 'Id', type: 'string' },
          },
          required: ['account', 'id'],
          additionalProperties: false,
          $defs: {},
        },
        'get_scheduled_mail input',
      )
    },
    validateOutput(value: unknown): asserts value is GetScheduledMailOutput {
      assertSchema(
        value,
        {
          $defs: {
            DeliveryError: {
              properties: {
                email: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Email' },
                reason: { title: 'Reason', type: 'string' },
              },
              required: ['email', 'reason'],
              title: 'DeliveryError',
              type: 'object',
            },
            Recipient: {
              properties: {
                type: { enum: ['To', 'Cc', 'Bcc'], title: 'Type', type: 'string' },
                email: { title: 'Email', type: 'string' },
                display_name: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                  title: 'Display Name',
                },
              },
              required: ['type', 'email', 'display_name'],
              title: 'Recipient',
              type: 'object',
            },
            RecipientState: {
              properties: {
                email: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Email' },
                status: {
                  enum: [
                    'failed',
                    'retrying',
                    'queued',
                    'scheduled',
                    'cancelled',
                    'sent',
                    'delivered',
                    'displayed',
                  ],
                  title: 'Status',
                  type: 'string',
                },
                reason: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Reason' },
                smtp_reply: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Smtp Reply' },
                delivered: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Delivered' },
                displayed: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Displayed' },
                retries: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Retries' },
                next_retry: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Next Retry' },
              },
              required: [
                'email',
                'status',
                'reason',
                'smtp_reply',
                'delivered',
                'displayed',
                'retries',
                'next_retry',
              ],
              title: 'RecipientState',
              type: 'object',
            },
          },
          properties: {
            id: { title: 'Id', type: 'string' },
            email_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Email Id' },
            thread_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Thread Id' },
            send_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Send At' },
            undo_status: {
              anyOf: [{ enum: ['pending', 'final', 'canceled'], type: 'string' }, { type: 'null' }],
              title: 'Undo Status',
            },
            status: {
              enum: [
                'failed',
                'retrying',
                'queued',
                'scheduled',
                'cancelled',
                'sent',
                'delivered',
                'displayed',
              ],
              title: 'Status',
              type: 'string',
            },
            retries: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Retries' },
            recipients_status: {
              items: { $ref: '#/$defs/RecipientState' },
              title: 'Recipients Status',
              type: 'array',
            },
            delivery_errors: {
              items: { $ref: '#/$defs/DeliveryError' },
              title: 'Delivery Errors',
              type: 'array',
            },
            subject: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Subject' },
            from_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Name' },
            from_email: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'From Email' },
            recipients: {
              items: { $ref: '#/$defs/Recipient' },
              title: 'Recipients',
              type: 'array',
            },
            email_deleted: { title: 'Email Deleted', type: 'boolean' },
            identity_email: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              title: 'Identity Email',
            },
            envelope_from: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              title: 'Envelope From',
            },
            envelope_recipients: {
              items: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              title: 'Envelope Recipients',
              type: 'array',
            },
            priority: { title: 'Priority', type: 'integer' },
            next_retry: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Next Retry' },
            dsn_count: { title: 'Dsn Count', type: 'integer' },
            mdn_count: { title: 'Mdn Count', type: 'integer' },
          },
          required: [
            'id',
            'email_id',
            'thread_id',
            'send_at',
            'undo_status',
            'status',
            'retries',
            'recipients_status',
            'delivery_errors',
            'subject',
            'from_name',
            'from_email',
            'recipients',
            'email_deleted',
            'identity_email',
            'envelope_from',
            'envelope_recipients',
            'priority',
            'next_retry',
            'dsn_count',
            'mdn_count',
          ],
          title: 'SubmissionDetail',
          type: 'object',
        },
        'get_scheduled_mail output',
      )
    },
  }

export const operationRescheduleMail: Validators<RescheduleMailInput, RescheduleMailOutput> = {
  validateInput(value: unknown): asserts value is RescheduleMailInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
          send_at: { title: 'Send At', type: 'string' },
        },
        required: ['account', 'id', 'send_at'],
        additionalProperties: false,
        $defs: {},
      },
      'reschedule_mail input',
    )
  },
  validateOutput(value: unknown): asserts value is RescheduleMailOutput {
    assertSchema(
      value,
      {
        properties: {
          id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Id' },
          send_at: { title: 'Send At', type: 'string' },
        },
        required: ['id', 'send_at'],
        title: 'RescheduleResult',
        type: 'object',
      },
      'reschedule_mail output',
    )
  },
}

export const operationSendScheduledMailNow: Validators<
  SendScheduledMailNowInput,
  SendScheduledMailNowOutput
> = {
  validateInput(value: unknown): asserts value is SendScheduledMailNowInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
        },
        required: ['account', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'send_scheduled_mail_now input',
    )
  },
  validateOutput(value: unknown): asserts value is SendScheduledMailNowOutput {
    assertSchema(
      value,
      {
        properties: {
          id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Id' },
          thread_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Thread Id' },
        },
        required: ['id', 'thread_id'],
        title: 'SendResult',
        type: 'object',
      },
      'send_scheduled_mail_now output',
    )
  },
}

export const operationCancelScheduledMail: Validators<
  CancelScheduledMailInput,
  CancelScheduledMailOutput
> = {
  validateInput(value: unknown): asserts value is CancelScheduledMailInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
        },
        required: ['account', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'cancel_scheduled_mail input',
    )
  },
  validateOutput(value: unknown): asserts value is CancelScheduledMailOutput {
    assertSchema(
      value,
      {
        properties: { id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Id' } },
        required: ['id'],
        title: 'IdResult',
        type: 'object',
      },
      'cancel_scheduled_mail output',
    )
  },
}

export const operationRetryFailedMail: Validators<RetryFailedMailInput, RetryFailedMailOutput> = {
  validateInput(value: unknown): asserts value is RetryFailedMailInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
        },
        required: ['account', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'retry_failed_mail input',
    )
  },
  validateOutput(value: unknown): asserts value is RetryFailedMailOutput {
    assertSchema(
      value,
      {
        properties: { id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Id' } },
        required: ['id'],
        title: 'IdResult',
        type: 'object',
      },
      'retry_failed_mail output',
    )
  },
}

export const operationDismissFailedMail: Validators<
  DismissFailedMailInput,
  DismissFailedMailOutput
> = {
  validateInput(value: unknown): asserts value is DismissFailedMailInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          account: { title: 'Account', type: 'string' },
          id: { title: 'Id', type: 'string' },
        },
        required: ['account', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'dismiss_failed_mail input',
    )
  },
  validateOutput(value: unknown): asserts value is DismissFailedMailOutput {
    assertSchema(value, { type: 'null' }, 'dismiss_failed_mail output')
  },
}

export const operationDeleteMessages: Validators<DeleteMessagesInput, DeleteMessagesOutput> = {
  validateInput(value: unknown): asserts value is DeleteMessagesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { names: { items: { type: 'string' }, title: 'Names', type: 'array' } },
        required: ['names'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_messages input',
    )
  },
  validateOutput(value: unknown): asserts value is DeleteMessagesOutput {
    assertSchema(value, { type: 'null' }, 'delete_messages output')
  },
}

export const operationFetchMailAsEml: Validators<FetchMailAsEmlInput, FetchMailAsEmlOutput> = {
  validateInput(value: unknown): asserts value is FetchMailAsEmlInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { title: 'Name', type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'fetch_mail_as_eml input',
    )
  },
  validateOutput(value: unknown): asserts value is FetchMailAsEmlOutput {
    if (!(value instanceof Blob)) throw new TypeError('Expected Blob')
  },
}

export const operationFetchPushSubscriptions: Validators<
  FetchPushSubscriptionsInput,
  FetchPushSubscriptionsOutput
> = {
  validateInput(value: unknown): asserts value is FetchPushSubscriptionsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          user: { title: 'User', type: 'string' },
          page: { title: 'Page', type: 'integer' },
          limit: { title: 'Limit', type: 'integer' },
        },
        required: ['user'],
        additionalProperties: false,
        $defs: {},
      },
      'fetch_push_subscriptions input',
    )
  },
  validateOutput(value: unknown): asserts value is FetchPushSubscriptionsOutput {
    assertSchema(
      value,
      {
        $defs: {
          Subscription: {
            properties: {
              user: { title: 'User', type: 'string' },
              id: { title: 'Id', type: 'string' },
              name: { title: 'Name', type: 'string' },
              device_client_id: { title: 'Device Client Id', type: 'string' },
              expires: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires' },
              types: { title: 'Types', type: 'string' },
              creation: { title: 'Creation', type: 'string' },
              modified: { title: 'Modified', type: 'string' },
            },
            required: [
              'user',
              'id',
              'name',
              'device_client_id',
              'expires',
              'types',
              'creation',
              'modified',
            ],
            title: 'Subscription',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/Subscription' },
        type: 'array',
      },
      'fetch_push_subscriptions output',
    )
  },
}

export const operationAddPushSubscription: Validators<
  AddPushSubscriptionInput,
  AddPushSubscriptionOutput
> = {
  validateInput(value: unknown): asserts value is AddPushSubscriptionInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          user: { title: 'User', type: 'string' },
          device_client_id: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Device Client Id',
          },
          url: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Url' },
          types: {
            anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'null' }],
            title: 'Types',
          },
        },
        required: ['user'],
        additionalProperties: false,
        $defs: {},
      },
      'add_push_subscription input',
    )
  },
  validateOutput(value: unknown): asserts value is AddPushSubscriptionOutput {
    assertSchema(value, { type: 'string' }, 'add_push_subscription output')
  },
}

export const operationRenewPushSubscription: Validators<
  RenewPushSubscriptionInput,
  RenewPushSubscriptionOutput
> = {
  validateInput(value: unknown): asserts value is RenewPushSubscriptionInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          user: { title: 'User', type: 'string' },
          id: { title: 'Id', type: 'string' },
        },
        required: ['user', 'id'],
        additionalProperties: false,
        $defs: {},
      },
      'renew_push_subscription input',
    )
  },
  validateOutput(value: unknown): asserts value is RenewPushSubscriptionOutput {
    assertSchema(value, { type: 'null' }, 'renew_push_subscription output')
  },
}

export const operationDeletePushSubscriptions: Validators<
  DeletePushSubscriptionsInput,
  DeletePushSubscriptionsOutput
> = {
  validateInput(value: unknown): asserts value is DeletePushSubscriptionsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { names: { items: { type: 'string' }, title: 'Names', type: 'array' } },
        required: ['names'],
        additionalProperties: false,
        $defs: {},
      },
      'delete_push_subscriptions input',
    )
  },
  validateOutput(value: unknown): asserts value is DeletePushSubscriptionsOutput {
    assertSchema(value, { type: 'null' }, 'delete_push_subscriptions output')
  },
}
