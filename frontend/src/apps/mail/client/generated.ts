// Generated from src/apps/mail/client/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

export type InboxSummaryInput = Record<string, never>

export type InboxSummaryOutput = { unread: number }

export type InboxSummaryError = never

const operationInboxSummary: QueryRef<InboxSummaryInput, InboxSummaryOutput, InboxSummaryError> = {
  id: 'inbox_summary',
  owner: 'mail',
  kind: 'query',
  publicName: 'inbox.summary',
  method: 'GET',
  path: 'inbox-summary',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationInboxSummary,
}

export type ExchangeInput = {
  doctype: 'Mail Exchange' | 'Contacts Exchange' | 'Calendar Exchange'
  name: string
}

export type ExchangeOutput = {
  name: string
  status: string
  operation: string
  started_at: string | null
  completed_at: string | null
  output: string | null
  import_format: string | null
  export_format: string | null
  export_archive_type: string | null
}

export type ExchangeError = never

const operationExchange: QueryRef<ExchangeInput, ExchangeOutput, ExchangeError> = {
  id: 'exchange',
  owner: 'mail',
  kind: 'query',
  publicName: 'exchanges.get',
  method: 'GET',
  path: 'exchanges/get',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationExchange,
}

export type ExchangeAttachmentOutputAttachment = {
  file_name: string
  file_url: string
  file_type: string | null
  file_size: number
}

export type ExchangeAttachmentInput = {
  doctype: 'Mail Exchange' | 'Contacts Exchange' | 'Calendar Exchange'
  name: string
}

export type ExchangeAttachmentOutput = ExchangeAttachmentOutputAttachment | null

export type ExchangeAttachmentError = never

const operationExchangeAttachment: QueryRef<
  ExchangeAttachmentInput,
  ExchangeAttachmentOutput,
  ExchangeAttachmentError
> = {
  id: 'exchange_attachment',
  owner: 'mail',
  kind: 'query',
  publicName: 'exchanges.attachment',
  method: 'GET',
  path: 'exchanges/attachment',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationExchangeAttachment,
}

export type ExchangeListOutputJob = {
  name: string
  status: string
  operation: string
  started_at: string | null
  completed_at: string | null
  output: string | null
  import_format: string | null
  export_format: string | null
  export_archive_type: string | null
}

export type ExchangeListInput = {
  doctype: 'Mail Exchange' | 'Contacts Exchange' | 'Calendar Exchange'
  operation: 'Import' | 'Export'
  status?: string
  start?: number
  page_length?: number
}

export type ExchangeListOutput = { items: Array<ExchangeListOutputJob>; total: number }

export type ExchangeListError = never

const operationExchangeList: PageRef<
  ExchangeListInput,
  ExchangeListOutputJob,
  ExchangeListError,
  ExchangeListOutput
> = {
  id: 'exchange_list',
  owner: 'mail',
  kind: 'query',
  publicName: 'exchanges.list',
  page: { offset: 'start', rows: 'items', total: 'total' },
  method: 'GET',
  path: 'exchanges',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationExchangeList,
}

export type CredentialsInput = Record<string, never>

export type CredentialsOutput = {
  server_url: string | null
  username: string | null
  backup_email: string | null
  has_password: boolean
}

export type CredentialsError = never

const operationCredentials: QueryRef<CredentialsInput, CredentialsOutput, CredentialsError> = {
  id: 'credentials',
  owner: 'mail',
  kind: 'query',
  publicName: 'settings.credentials',
  method: 'GET',
  path: 'settings/credentials',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationCredentials,
}

export type UpdateCredentialsInput = {
  username: string | null
  backup_email: string | null
  app_password?: string
}

export type UpdateCredentialsOutput = null

export type UpdateCredentialsError = never

const operationUpdateCredentials: MutationRef<
  UpdateCredentialsInput,
  UpdateCredentialsOutput,
  UpdateCredentialsError
> = {
  id: 'update_credentials',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'settings.updateCredentials',
  empty: true,
  method: 'PATCH',
  path: 'settings/credentials',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationUpdateCredentials,
}

export type UpdatePreferencesInput = {
  group_messages_by?: ('None' | 'Day' | 'Month') | null
  show_reading_pane?: 0 | 1
  undo_send_period?: '5' | '10' | '20' | '30'
}

export type UpdatePreferencesOutput = null

export type UpdatePreferencesError = never

const operationUpdatePreferences: MutationRef<
  UpdatePreferencesInput,
  UpdatePreferencesOutput,
  UpdatePreferencesError
> = {
  id: 'update_preferences',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'settings.updatePreferences',
  empty: true,
  method: 'PATCH',
  path: 'settings/preferences',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationUpdatePreferences,
}

export type AccountPreferencesInput = { account: string }

export type AccountPreferencesOutput = {
  create_contacts_after_email_submit: 0 | 1
  destroy_email_after_submit: 0 | 1
  destroy_newsletter_after_submit: 0 | 1
  keep_forwarded_email_in_thread: 0 | 1
  enable_screening: 0 | 1
  block_remote_images: 0 | 1
  on_block_old_mail: 'Ask' | 'Move to Junk' | 'Keep'
  default_outgoing_email: string | null
}

export type AccountPreferencesError = never

const operationAccountPreferences: QueryRef<
  AccountPreferencesInput,
  AccountPreferencesOutput,
  AccountPreferencesError
> = {
  id: 'account_preferences',
  owner: 'mail',
  kind: 'query',
  publicName: 'settings.account',
  method: 'GET',
  path: 'settings/account',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationAccountPreferences,
}

export type UpdateAccountPreferencesInputAccountChanges = {
  create_contacts_after_email_submit?: 0 | 1
  destroy_email_after_submit?: 0 | 1
  destroy_newsletter_after_submit?: 0 | 1
  keep_forwarded_email_in_thread?: 0 | 1
  enable_screening?: 0 | 1
  block_remote_images?: 0 | 1
  on_block_old_mail?: 'Ask' | 'Move to Junk' | 'Keep'
  default_outgoing_email?: string | null
}

export type UpdateAccountPreferencesInput = {
  account: string
  changes: UpdateAccountPreferencesInputAccountChanges
}

export type UpdateAccountPreferencesOutput = null

export type UpdateAccountPreferencesError = never

const operationUpdateAccountPreferences: MutationRef<
  UpdateAccountPreferencesInput,
  UpdateAccountPreferencesOutput,
  UpdateAccountPreferencesError
> = {
  id: 'update_account_preferences',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'settings.updateAccount',
  empty: true,
  method: 'PATCH',
  path: 'settings/account',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationUpdateAccountPreferences,
}

export type SubscribeMailboxInput = { name: string; subscribed: 0 | 1 }

export type SubscribeMailboxOutput = null

export type SubscribeMailboxError = never

const operationSubscribeMailbox: MutationRef<
  SubscribeMailboxInput,
  SubscribeMailboxOutput,
  SubscribeMailboxError
> = {
  id: 'subscribe_mailbox',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'mailboxes.subscribe',
  empty: true,
  method: 'PATCH',
  path: 'settings/mailbox',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationSubscribeMailbox,
}

export type SaveIdentityInputAddress = { display_name: string | null; email: string }

export type SaveIdentityInput = {
  account: string
  id: string
  name: string | null
  reply_to: Array<SaveIdentityInputAddress>
  bcc: Array<SaveIdentityInputAddress>
  html_signature: string | null
}

export type SaveIdentityOutput = null

export type SaveIdentityError = never

const operationSaveIdentity: MutationRef<SaveIdentityInput, SaveIdentityOutput, SaveIdentityError> =
  {
    id: 'save_identity',
    owner: 'mail',
    kind: 'mutation',
    publicName: 'identities.save',
    empty: true,
    method: 'PATCH',
    path: 'identities',
    prefix: '/api/suite/mail/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: [],
    loadValidators: async () => (await import('./validators')).operationSaveIdentity,
  }

export type SignaturesOutputSignature = {
  name: string
  signature_name: string
  html_body: string | null
}

export type SignaturesInput = Record<string, never>

export type SignaturesOutput = Array<SignaturesOutputSignature>

export type SignaturesError = never

const operationSignatures: QueryRef<SignaturesInput, SignaturesOutput, SignaturesError> = {
  id: 'signatures',
  owner: 'mail',
  kind: 'query',
  publicName: 'signatures.list',
  method: 'GET',
  path: 'signatures',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationSignatures,
}

export type CreateSignatureInput = { signature_name: string; html_body: string | null }

export type CreateSignatureOutput = string

export type CreateSignatureError = never

const operationCreateSignature: MutationRef<
  CreateSignatureInput,
  CreateSignatureOutput,
  CreateSignatureError
> = {
  id: 'create_signature',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'signatures.create',
  method: 'POST',
  path: 'signatures',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationCreateSignature,
}

export type UpdateSignatureInput = {
  signature_name: string
  html_body: string | null
  name: string
}

export type UpdateSignatureOutput = null

export type UpdateSignatureError = never

const operationUpdateSignature: MutationRef<
  UpdateSignatureInput,
  UpdateSignatureOutput,
  UpdateSignatureError
> = {
  id: 'update_signature',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'signatures.update',
  empty: true,
  method: 'PATCH',
  path: 'signatures',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationUpdateSignature,
}

export type DeleteSignatureInput = { name: string }

export type DeleteSignatureOutput = null

export type DeleteSignatureError = never

const operationDeleteSignature: MutationRef<
  DeleteSignatureInput,
  DeleteSignatureOutput,
  DeleteSignatureError
> = {
  id: 'delete_signature',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'signatures.delete',
  empty: true,
  method: 'DELETE',
  path: 'signatures',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationDeleteSignature,
}

export type InviteInput = { name: string }

export type InviteOutput = {
  name: string
  account: string
  aliases: string | null
  is_admin: 0 | 1
  backup_email: string | null
  invited_by: string | null
  expires_at: string | null
  quota_gb: number | null
  combined_cap_bytes: number | null
  send_invite: 0 | 1
  disable_receiving: 0 | 1
  is_verified: 0 | 1
  groups: string | null
  mailing_lists: string | null
}

export type InviteError = 'PermissionError' | 'DoesNotExistError'

const operationInvite: QueryRef<InviteInput, InviteOutput, InviteError> = {
  id: 'invite',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.invites.get',
  method: 'GET',
  path: 'admin/invites/{name}',
  prefix: '/api/suite/mail/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'DoesNotExistError'],
  loadValidators: async () => (await import('./validators')).operationInvite,
}

export type UpdateInviteInput = {
  name: string
  expires_at: string | null
  combined_cap_bytes: number | null
  account?: string
  is_admin?: boolean
}

export type UpdateInviteOutput = null

export type UpdateInviteError = 'BadRequest' | 'PermissionError' | 'DoesNotExistError'

const operationUpdateInvite: MutationRef<UpdateInviteInput, UpdateInviteOutput, UpdateInviteError> =
  {
    id: 'update_invite',
    owner: 'mail',
    kind: 'mutation',
    publicName: 'admin.invites.update',
    empty: true,
    method: 'PATCH',
    path: 'admin/invites/{name}',
    prefix: '/api/suite/mail/',
    pathParams: ['name'],
    nodeParams: [],
    entity: null,
    errors: ['BadRequest', 'PermissionError', 'DoesNotExistError'],
    loadValidators: async () => (await import('./validators')).operationUpdateInvite,
  }

export type SendInviteInput = { name: string }

export type SendInviteOutput = null

export type SendInviteError = 'BadRequest' | 'PermissionError' | 'DoesNotExistError'

const operationSendInvite: MutationRef<SendInviteInput, SendInviteOutput, SendInviteError> = {
  id: 'send_invite',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.invites.send',
  empty: true,
  method: 'POST',
  path: 'admin/invites/{name}/send',
  prefix: '/api/suite/mail/',
  pathParams: ['name'],
  nodeParams: [],
  entity: null,
  errors: ['BadRequest', 'PermissionError', 'DoesNotExistError'],
  loadValidators: async () => (await import('./validators')).operationSendInvite,
}

export type ContactOutputBookMembership = {
  address_book: string
  address_book_id: string
  address_book_name: string | null
}

export type ContactOutputEmail = {
  address: string | null
  type?: string | null
  label?: string | null
  contexts?: string | null
}

export type ContactOutputPhone = {
  number: string | null
  type?: string | null
  label?: string | null
  contexts?: string | null
}

export type ContactOutputPostalAddress = {
  idx?: number
  type?: string | null
  street?: string | null
  locality?: string | null
  region?: string | null
  postcode?: string | null
  country?: string | null
  time_zone?: string | null
  contexts?: string | null
}

export type ContactInput = { account: string; id: string }

export type ContactOutput = {
  id: string
  full_name: string | null
  kind: string | null
  emails: Array<ContactOutputEmail>
  name: string
  account: string
  uid: string | null
  name_breakup: string
  address_books: Array<ContactOutputBookMembership>
  phones: Array<ContactOutputPhone>
  addresses: Array<ContactOutputPostalAddress>
  created_at: string | null
  updated_at: string | null
  creation: string
  modified: string
}

export type ContactError = never

const operationContact: QueryRef<ContactInput, ContactOutput, ContactError> = {
  id: 'contact',
  owner: 'mail',
  kind: 'query',
  publicName: 'contacts.get',
  method: 'GET',
  path: 'contacts/card',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationContact,
}

export type UpdateContactInputBookMembership = {
  address_book: string
  address_book_id: string
  address_book_name: string | null
}

export type UpdateContactInputCardChanges = {
  full_name?: string | null
  kind?: string | null
  emails?: Array<UpdateContactInputEmail>
  phones?: Array<UpdateContactInputPhone>
  addresses?: Array<UpdateContactInputPostalAddress>
  address_books?: Array<UpdateContactInputBookMembership>
}

export type UpdateContactInputEmail = {
  address: string | null
  type?: string | null
  label?: string | null
  contexts?: string | null
}

export type UpdateContactInputPhone = {
  number: string | null
  type?: string | null
  label?: string | null
  contexts?: string | null
}

export type UpdateContactInputPostalAddress = {
  idx?: number
  type?: string | null
  street?: string | null
  locality?: string | null
  region?: string | null
  postcode?: string | null
  country?: string | null
  time_zone?: string | null
  contexts?: string | null
}

export type UpdateContactInput = {
  account: string
  id: string
  changes: UpdateContactInputCardChanges
}

export type UpdateContactOutput = null

export type UpdateContactError = never

const operationUpdateContact: MutationRef<
  UpdateContactInput,
  UpdateContactOutput,
  UpdateContactError
> = {
  id: 'update_contact',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'contacts.update',
  empty: true,
  method: 'PATCH',
  path: 'contacts/card',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationUpdateContact,
}

export type BookInput = { account: string; id: string }

export type BookOutput = {
  name: string
  account: string
  id: string
  _name: string
  sort_order: number
  description: string | null
  default: 0 | 1
  subscribed: 0 | 1
  may_read: 0 | 1
  may_write: 0 | 1
  may_admin: 0 | 1
  may_delete: 0 | 1
  creation: string
  modified: string
}

export type BookError = never

const operationBook: QueryRef<BookInput, BookOutput, BookError> = {
  id: 'book',
  owner: 'mail',
  kind: 'query',
  publicName: 'addressBooks.get',
  method: 'GET',
  path: 'address-books/book',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationBook,
}

export type UpdateBookInputBookChanges = {
  _name?: string
  description?: string | null
  sort_order?: number
  default?: boolean | (0 | 1)
  subscribed?: boolean | (0 | 1)
}

export type UpdateBookInput = { account: string; id: string; changes: UpdateBookInputBookChanges }

export type UpdateBookOutput = null

export type UpdateBookError = never

const operationUpdateBook: MutationRef<UpdateBookInput, UpdateBookOutput, UpdateBookError> = {
  id: 'update_book',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'addressBooks.update',
  empty: true,
  method: 'PATCH',
  path: 'address-books/book',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationUpdateBook,
}

export type GetUserInfoOutputUserAccount = {
  account: string
  id: string
  _name: string | null
  is_personal: boolean
  in_mail: boolean
  in_calendar: boolean
  jmap_account: string | null
  default_outgoing_email: string | null
  enable_screening: boolean
  block_remote_images: boolean
  on_block_old_mail: string
}

export type GetUserInfoOutputUserInfo = {
  name: string
  email: string
  full_name: string
  first_name: string | null
  last_name: string | null
  enabled: 0 | 1
  user_image: string | null
  user_type: string
  username: string | null
  api_key: string | null
  time_zone: string
  system_time_zone: string
  group_messages_by: string | null
  show_reading_pane: 0 | 1
  undo_send_period: string | null
  user_settings: string
  is_suite_admin: boolean
  is_system_manager: boolean
  is_jmap_configured: boolean
  max_attachment_size: number
  is_suite_cloud_configured: boolean
  accounts: Array<GetUserInfoOutputUserAccount>
}

export type GetUserInfoInput = Record<string, never>

export type GetUserInfoOutput = GetUserInfoOutputUserInfo | null

export type GetUserInfoError = 'PermissionError' | 'AuthenticationError'

const operationGetUserInfo: QueryRef<GetUserInfoInput, GetUserInfoOutput, GetUserInfoError> = {
  id: 'get_user_info',
  owner: 'mail',
  kind: 'query',
  publicName: 'account.get',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.get_user_info',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError'],
  loadValidators: async () => (await import('./validators')).operationGetUserInfo,
}

export type GetAllInboxUnreadCountInput = Record<string, never>

export type GetAllInboxUnreadCountOutput = number

export type GetAllInboxUnreadCountError = 'PermissionError' | 'AuthenticationError'

const operationGetAllInboxUnreadCount: QueryRef<
  GetAllInboxUnreadCountInput,
  GetAllInboxUnreadCountOutput,
  GetAllInboxUnreadCountError
> = {
  id: 'get_all_inbox_unread_count',
  owner: 'mail',
  kind: 'query',
  publicName: 'inbox.unreadCount',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.get_all_inbox_unread_count',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError'],
  loadValidators: async () => (await import('./validators')).operationGetAllInboxUnreadCount,
}

export type GetUnifiedFoldersOutputUnifiedFolder = {
  slug: string
  name: string
  role: string | null
  unread_threads: number
  accounts: Array<string>
  icon: string | null
  color: ('Blue' | 'Green' | 'Amber' | 'Red' | 'Purple') | null
}

export type GetUnifiedFoldersInput = Record<string, never>

export type GetUnifiedFoldersOutput = Array<GetUnifiedFoldersOutputUnifiedFolder>

export type GetUnifiedFoldersError = 'PermissionError' | 'AuthenticationError'

const operationGetUnifiedFolders: QueryRef<
  GetUnifiedFoldersInput,
  GetUnifiedFoldersOutput,
  GetUnifiedFoldersError
> = {
  id: 'get_unified_folders',
  owner: 'mail',
  kind: 'query',
  publicName: 'unified.folders',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.get_unified_folders',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError'],
  loadValidators: async () => (await import('./validators')).operationGetUnifiedFolders,
}

export type GetMailboxesOutputAutomationRules = {
  emails_from: string
  subject_contains: string
  match_if: 'any' | 'all'
  mark_as_read: boolean
  add_star: boolean
}

export type GetMailboxesOutputMailbox = {
  name: string
  id: string
  _name: string
  role: ('inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'important') | null
  total_emails: number
  total_threads: number
  unread_threads: number
  slug: string | null
  subscribed: boolean
  icon?: string | null
  color?: ('Blue' | 'Green' | 'Amber' | 'Red' | 'Purple') | null
  disable_push_notification?: 0 | 1
  automation_rules?: GetMailboxesOutputAutomationRules | null
}

export type GetMailboxesInput = { account: string }

export type GetMailboxesOutput = Array<GetMailboxesOutputMailbox>

export type GetMailboxesError = 'PermissionError' | 'AuthenticationError'

const operationGetMailboxes: QueryRef<GetMailboxesInput, GetMailboxesOutput, GetMailboxesError> = {
  id: 'get_mailboxes',
  owner: 'mail',
  kind: 'query',
  publicName: 'mailboxes.list',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.get_mailboxes',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError'],
  loadValidators: async () => (await import('./validators')).operationGetMailboxes,
}

export type GetIdentitiesOutputAddress = { display_name: string | null; email: string }

export type GetIdentitiesOutputIdentity = {
  name: string
  account: string
  id: string
  _name: string
  email: string
  bcc: Array<GetIdentitiesOutputAddress>
  reply_to: Array<GetIdentitiesOutputAddress>
  html_signature: string
  text_signature: string
  may_delete: 0 | 1
  owner: string
  modified_by: string
  creation: string
  modified: string
}

export type GetIdentitiesInput = { account: string }

export type GetIdentitiesOutput = Array<GetIdentitiesOutputIdentity>

export type GetIdentitiesError = 'PermissionError' | 'AuthenticationError'

const operationGetIdentities: QueryRef<
  GetIdentitiesInput,
  GetIdentitiesOutput,
  GetIdentitiesError
> = {
  id: 'get_identities',
  owner: 'mail',
  kind: 'query',
  publicName: 'identities.list',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.get_identities',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError'],
  loadValidators: async () => (await import('./validators')).operationGetIdentities,
}

export type GetParticipantIdentitiesOutputParticipantIdentity = {
  name: string
  account: string
  id: string
  _name: string
  email: string
  default: 0 | 1
  owner: string
  modified_by: string
  creation: string
  modified: string
}

export type GetParticipantIdentitiesInput = { account: string }

export type GetParticipantIdentitiesOutput =
  Array<GetParticipantIdentitiesOutputParticipantIdentity>

export type GetParticipantIdentitiesError = 'PermissionError' | 'AuthenticationError'

const operationGetParticipantIdentities: QueryRef<
  GetParticipantIdentitiesInput,
  GetParticipantIdentitiesOutput,
  GetParticipantIdentitiesError
> = {
  id: 'get_participant_identities',
  owner: 'mail',
  kind: 'query',
  publicName: 'participantIdentities.list',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.get_participant_identities',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError'],
  loadValidators: async () => (await import('./validators')).operationGetParticipantIdentities,
}

export type GetAddressBooksOutputAddressBook = {
  name: string
  id: string
  _name: string
  default: 0 | 1
}

export type GetAddressBooksInput = { account: string }

export type GetAddressBooksOutput = Array<GetAddressBooksOutputAddressBook>

export type GetAddressBooksError = 'PermissionError' | 'AuthenticationError'

const operationGetAddressBooks: QueryRef<
  GetAddressBooksInput,
  GetAddressBooksOutput,
  GetAddressBooksError
> = {
  id: 'get_address_books',
  owner: 'mail',
  kind: 'query',
  publicName: 'addressBooks.list',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.contacts.get_address_books',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError'],
  loadValidators: async () => (await import('./validators')).operationGetAddressBooks,
}

export type GetScreenedAddressesOutputScreenedAddress = {
  email: string
  action: 'Spam' | 'Accepted'
  creation: string
  modified: string
}

export type GetScreenedAddressesInput = { account: string }

export type GetScreenedAddressesOutput = Array<GetScreenedAddressesOutputScreenedAddress>

export type GetScreenedAddressesError = 'PermissionError' | 'AuthenticationError'

const operationGetScreenedAddresses: QueryRef<
  GetScreenedAddressesInput,
  GetScreenedAddressesOutput,
  GetScreenedAddressesError
> = {
  id: 'get_screened_addresses',
  owner: 'mail',
  kind: 'query',
  publicName: 'screening.list',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.get_screened_addresses',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError'],
  loadValidators: async () => (await import('./validators')).operationGetScreenedAddresses,
}

export type GetGlobalScreenedAddressesOutputScreenedAddress = {
  email: string
  action: 'Spam' | 'Accepted'
  creation: string
  modified: string
}

export type GetGlobalScreenedAddressesInput = Record<string, never>

export type GetGlobalScreenedAddressesOutput =
  Array<GetGlobalScreenedAddressesOutputScreenedAddress>

export type GetGlobalScreenedAddressesError = 'PermissionError' | 'AuthenticationError'

const operationGetGlobalScreenedAddresses: QueryRef<
  GetGlobalScreenedAddressesInput,
  GetGlobalScreenedAddressesOutput,
  GetGlobalScreenedAddressesError
> = {
  id: 'get_global_screened_addresses',
  owner: 'mail',
  kind: 'query',
  publicName: 'screening.global',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.get_global_screened_addresses',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError'],
  loadValidators: async () => (await import('./validators')).operationGetGlobalScreenedAddresses,
}

export type GetSieveScriptsOutputSieveScript = {
  name: string
  account: string
  id: string
  _name: string
  active: 0 | 1
  blob_id: string
  content: string
  read_only: boolean
  creation: string
  modified: string
}

export type GetSieveScriptsInput = { account: string }

export type GetSieveScriptsOutput = Array<GetSieveScriptsOutputSieveScript>

export type GetSieveScriptsError = 'PermissionError' | 'AuthenticationError'

const operationGetSieveScripts: QueryRef<
  GetSieveScriptsInput,
  GetSieveScriptsOutput,
  GetSieveScriptsError
> = {
  id: 'get_sieve_scripts',
  owner: 'mail',
  kind: 'query',
  publicName: 'sieve.list',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.sieve.get_sieve_scripts',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError'],
  loadValidators: async () => (await import('./validators')).operationGetSieveScripts,
}

export type GetDomainsOutputDomainRow = {
  id: string
  name: string
  description: string
  status: 'Active' | 'Pending Verification' | 'Disabled'
  is_enabled: boolean
  catch_all_address: string
  sub_addressing: boolean
  allow_relaying: boolean
  is_verified: boolean
  last_verified_at: string | null
  created_at: string | null
}

export type GetDomainsInput = {
  start?: number
  page_length?: number
  txt?: string | null
  status?: ('Active' | 'Pending Verification' | 'Disabled') | null
}

export type GetDomainsOutput = { items: Array<GetDomainsOutputDomainRow>; total: number }

export type GetDomainsError = 'PermissionError' | 'ValidationError'

const operationGetDomains: PageRef<
  GetDomainsInput,
  GetDomainsOutputDomainRow,
  GetDomainsError,
  GetDomainsOutput
> = {
  id: 'get_domains',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.domains.list',
  envelope: 'message',
  page: { offset: 'start', rows: 'items', total: 'total' },
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_domains',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetDomains,
}

export type GetMembersOutputMemberRow = {
  name: string
  full_name: string
  user_image: string
  last_active: string | null
  enabled: boolean
  account: string | null
  is_admin: boolean
  quota_gb: number | null
  used_bytes: number | null
}

export type GetMembersInput = {
  start?: number
  page_length?: number
  search?: string | null
  is_admin?: boolean | null
  is_enabled?: boolean | null
}

export type GetMembersOutput = { items: Array<GetMembersOutputMemberRow>; total: number }

export type GetMembersError = 'PermissionError' | 'ValidationError'

const operationGetMembers: PageRef<
  GetMembersInput,
  GetMembersOutputMemberRow,
  GetMembersError,
  GetMembersOutput
> = {
  id: 'get_members',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.members.list',
  envelope: 'message',
  page: { offset: 'start', rows: 'items', total: 'total' },
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_members',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetMembers,
}

export type GetAccountRequestsOutputInviteRow = {
  name: string
  account: string
  is_admin: 0 | 1
  backup_email: string | null
  invited_by: string
  is_verified: 0 | 1
  status: 'Pending' | 'Accepted' | 'Expired'
}

export type GetAccountRequestsInput = {
  start?: number
  page_length?: number
  search?: string | null
  status?: 'All' | 'Pending' | 'Accepted' | 'Expired'
}

export type GetAccountRequestsOutput = {
  items: Array<GetAccountRequestsOutputInviteRow>
  total: number
}

export type GetAccountRequestsError = 'PermissionError' | 'ValidationError'

const operationGetAccountRequests: PageRef<
  GetAccountRequestsInput,
  GetAccountRequestsOutputInviteRow,
  GetAccountRequestsError,
  GetAccountRequestsOutput
> = {
  id: 'get_account_requests',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.invites.list',
  envelope: 'message',
  page: { offset: 'start', rows: 'items', total: 'total' },
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_account_requests',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetAccountRequests,
}

export type GetGroupsOutputGroupRow = {
  id: string
  name: string
  email: string
  description: string | null
  disable_receiving: boolean
  quota_gb: number
  used_bytes: number | null
  created_at: string | null
}

export type GetGroupsInput = { start?: number; page_length?: number; search?: string | null }

export type GetGroupsOutput = { items: Array<GetGroupsOutputGroupRow>; total: number }

export type GetGroupsError = 'PermissionError' | 'ValidationError'

const operationGetGroups: PageRef<
  GetGroupsInput,
  GetGroupsOutputGroupRow,
  GetGroupsError,
  GetGroupsOutput
> = {
  id: 'get_groups',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.groups.list',
  envelope: 'message',
  page: { offset: 'start', rows: 'items', total: 'total' },
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_groups',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetGroups,
}

export type GetMailingListsOutputMailingListRow = {
  id: string
  name: string
  email: string
  description: string | null
  recipient_count: number
}

export type GetMailingListsInput = { start?: number; page_length?: number; search?: string | null }

export type GetMailingListsOutput = {
  items: Array<GetMailingListsOutputMailingListRow>
  total: number
}

export type GetMailingListsError = 'PermissionError' | 'ValidationError'

const operationGetMailingLists: PageRef<
  GetMailingListsInput,
  GetMailingListsOutputMailingListRow,
  GetMailingListsError,
  GetMailingListsOutput
> = {
  id: 'get_mailing_lists',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.mailingLists.list',
  envelope: 'message',
  page: { offset: 'start', rows: 'items', total: 'total' },
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_mailing_lists',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetMailingLists,
}

export type GetMailingListRecipientsOutputRecipientRow = { email: string; enabled: boolean }

export type GetMailingListRecipientsInput = {
  start?: number
  page_length?: number
  search?: string | null
  list_id: string
}

export type GetMailingListRecipientsOutput = {
  items: Array<GetMailingListRecipientsOutputRecipientRow>
  total: number
}

export type GetMailingListRecipientsError = 'PermissionError' | 'ValidationError'

const operationGetMailingListRecipients: PageRef<
  GetMailingListRecipientsInput,
  GetMailingListRecipientsOutputRecipientRow,
  GetMailingListRecipientsError,
  GetMailingListRecipientsOutput
> = {
  id: 'get_mailing_list_recipients',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.recipients.list',
  envelope: 'message',
  page: { offset: 'start', rows: 'items', total: 'total' },
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_mailing_list_recipients',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetMailingListRecipients,
}

export type GetDmarcReportsOutputDmarcPolicy = {
  domain?: string
  testing_mode?: boolean
  adkim?: string | null
  aspf?: string | null
  p?: string | null
  sp?: string | null
  pct?: number
  fo?: string
}

export type GetDmarcReportsOutputDmarcRow = {
  id: string
  domain: string | null
  reporter: string | null
  reporter_email: string | null
  report_id: string | null
  subject: string | null
  to: Array<string>
  date_range_begin: string | null
  date_range_end: string | null
  received_at: string | null
  reports: number
  version: number | null
  policy: GetDmarcReportsOutputDmarcPolicy
  errors: string | null
  pass_rate: number | null
  messages: number
  passed: number
  failed: number
  dkim_passed: number
  spf_passed: number
}

export type GetDmarcReportsInput = {
  start?: number
  page_length?: number
  txt?: string | null
  domain_id?: string | null
  days?: number
}

export type GetDmarcReportsOutput = { items: Array<GetDmarcReportsOutputDmarcRow>; total: number }

export type GetDmarcReportsError = 'PermissionError' | 'ValidationError'

const operationGetDmarcReports: PageRef<
  GetDmarcReportsInput,
  GetDmarcReportsOutputDmarcRow,
  GetDmarcReportsError,
  GetDmarcReportsOutput
> = {
  id: 'get_dmarc_reports',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.dmarc.list',
  envelope: 'message',
  page: { offset: 'start', rows: 'items', total: 'total' },
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_dmarc_reports',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetDmarcReports,
}

export type GetTlsReportsOutputTlsRow = {
  id: string
  domain: string | null
  reporter: string | null
  reporter_email: string | null
  report_id: string | null
  subject: string | null
  to: Array<string>
  date_range_begin: string | null
  date_range_end: string | null
  received_at: string | null
  reports: number
  contact_info: string | null
  policy_types: Array<string>
  successful: number
  failed: number
  sessions: number
  success_rate: number | null
}

export type GetTlsReportsInput = {
  start?: number
  page_length?: number
  txt?: string | null
  domain_id?: string | null
  days?: number
}

export type GetTlsReportsOutput = { items: Array<GetTlsReportsOutputTlsRow>; total: number }

export type GetTlsReportsError = 'PermissionError' | 'ValidationError'

const operationGetTlsReports: PageRef<
  GetTlsReportsInput,
  GetTlsReportsOutputTlsRow,
  GetTlsReportsError,
  GetTlsReportsOutput
> = {
  id: 'get_tls_reports',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.tls.list',
  envelope: 'message',
  page: { offset: 'start', rows: 'items', total: 'total' },
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_tls_reports',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetTlsReports,
}

export type ScreenEmailAddressesInput = {
  account: string
  emails: Array<string>
  action?: 'Spam' | 'Accepted'
  override?: boolean
}

export type ScreenEmailAddressesOutput = null

export type ScreenEmailAddressesError = 'PermissionError' | 'ValidationError'

const operationScreenEmailAddresses: MutationRef<
  ScreenEmailAddressesInput,
  ScreenEmailAddressesOutput,
  ScreenEmailAddressesError
> = {
  id: 'screen_email_addresses',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'screening.set',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.screen_email_addresses',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationScreenEmailAddresses,
}

export type UnscreenEmailAddressesInput = { account: string; emails: Array<string> }

export type UnscreenEmailAddressesOutput = null

export type UnscreenEmailAddressesError = 'PermissionError' | 'ValidationError'

const operationUnscreenEmailAddresses: MutationRef<
  UnscreenEmailAddressesInput,
  UnscreenEmailAddressesOutput,
  UnscreenEmailAddressesError
> = {
  id: 'unscreen_email_addresses',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'screening.remove',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.unscreen_email_addresses',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationUnscreenEmailAddresses,
}

export type GetCalendarClientConfigInput = Record<string, never>

export type GetCalendarClientConfigOutput = {
  server_url?: string
  calendar_url?: string
  username?: string
}

export type GetCalendarClientConfigError = 'PermissionError'

const operationGetCalendarClientConfig: QueryRef<
  GetCalendarClientConfigInput,
  GetCalendarClientConfigOutput,
  GetCalendarClientConfigError
> = {
  id: 'get_calendar_client_config',
  owner: 'mail',
  kind: 'query',
  publicName: 'calendar.clientConfig',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.get_calendar_client_config',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError'],
  loadValidators: async () => (await import('./validators')).operationGetCalendarClientConfig,
}

export type GetEmailSuggestionsOutputEmailSuggestion = {
  name: string | null
  email: string
  user_image?: string | null
}

export type GetEmailSuggestionsInput = { account: string; text: string; limit?: number }

export type GetEmailSuggestionsOutput = Array<GetEmailSuggestionsOutputEmailSuggestion>

export type GetEmailSuggestionsError = 'PermissionError'

const operationGetEmailSuggestions: QueryRef<
  GetEmailSuggestionsInput,
  GetEmailSuggestionsOutput,
  GetEmailSuggestionsError
> = {
  id: 'get_email_suggestions',
  owner: 'mail',
  kind: 'query',
  publicName: 'contacts.suggest',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.get_email_suggestions',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError'],
  loadValidators: async () => (await import('./validators')).operationGetEmailSuggestions,
}

export type CreateCalendarImportInput = {
  account: string
  format: 'ics' | 'jmap'
  file: string
  calendar?: string | null
}

export type CreateCalendarImportOutput = null

export type CreateCalendarImportError = 'PermissionError' | 'ValidationError'

const operationCreateCalendarImport: MutationRef<
  CreateCalendarImportInput,
  CreateCalendarImportOutput,
  CreateCalendarImportError
> = {
  id: 'create_calendar_import',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'calendar.import',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.create_calendar_import',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationCreateCalendarImport,
}

export type CreateCalendarExportInputCalendarExportFilter = {
  title?: string
  inCalendar?: string
  after?: string
  before?: string
}

export type CreateCalendarExportInput = {
  account: string
  format: 'ics' | 'jmap'
  archive_type: '.zip' | '.tgz' | '.tar.gz'
  sort: 'Start (ASC)' | 'Start (DESC)'
  limit?: number | null
  filter?: CreateCalendarExportInputCalendarExportFilter | null
}

export type CreateCalendarExportOutput = null

export type CreateCalendarExportError = 'PermissionError' | 'ValidationError'

const operationCreateCalendarExport: MutationRef<
  CreateCalendarExportInput,
  CreateCalendarExportOutput,
  CreateCalendarExportError
> = {
  id: 'create_calendar_export',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'calendar.export',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.create_calendar_export',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationCreateCalendarExport,
}

export type OngoingCalendarExchangeInputExchangeFilters = {
  user: string
  account?: string
  operation: 'Import' | 'Export'
  status: ['in', Array<'Queued' | 'In Progress'>]
}

export type OngoingCalendarExchangeOutputExchangeName = { name?: string }

export type OngoingCalendarExchangeInput = {
  doctype: 'Calendar Exchange'
  fieldname: 'name'
  filters: OngoingCalendarExchangeInputExchangeFilters
}

export type OngoingCalendarExchangeOutput = OngoingCalendarExchangeOutputExchangeName | null

export type OngoingCalendarExchangeError = 'PermissionError'

const operationOngoingCalendarExchange: QueryRef<
  OngoingCalendarExchangeInput,
  OngoingCalendarExchangeOutput,
  OngoingCalendarExchangeError
> = {
  id: 'ongoing_calendar_exchange',
  owner: 'mail',
  kind: 'query',
  publicName: 'calendar.ongoingExchange',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/frappe.client.get_value',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError'],
  loadValidators: async () => (await import('./validators')).operationOngoingCalendarExchange,
}

export type AddParticipantIdentityInput = {
  account: string
  name: string
  email: string
  default?: boolean
}

export type AddParticipantIdentityOutput = string

export type AddParticipantIdentityError = 'PermissionError' | 'ValidationError'

const operationAddParticipantIdentity: MutationRef<
  AddParticipantIdentityInput,
  AddParticipantIdentityOutput,
  AddParticipantIdentityError
> = {
  id: 'add_participant_identity',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'participantIdentities.create',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.participant_identity.participant_identity.add_participant_identity',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddParticipantIdentity,
}

export type UpdateParticipantIdentityInput = {
  account: string
  name: string
  email: string
  default?: boolean
  id: string
}

export type UpdateParticipantIdentityOutput = null

export type UpdateParticipantIdentityError = 'PermissionError' | 'ValidationError'

const operationUpdateParticipantIdentity: MutationRef<
  UpdateParticipantIdentityInput,
  UpdateParticipantIdentityOutput,
  UpdateParticipantIdentityError
> = {
  id: 'update_participant_identity',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'participantIdentities.update',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.participant_identity.participant_identity.update_participant_identity',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationUpdateParticipantIdentity,
}

export type DeleteParticipantIdentitiesInput = { names: Array<string> }

export type DeleteParticipantIdentitiesOutput = null

export type DeleteParticipantIdentitiesError = 'PermissionError' | 'ValidationError'

const operationDeleteParticipantIdentities: MutationRef<
  DeleteParticipantIdentitiesInput,
  DeleteParticipantIdentitiesOutput,
  DeleteParticipantIdentitiesError
> = {
  id: 'delete_participant_identities',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'participantIdentities.delete',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.participant_identity.participant_identity.bulk_delete',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteParticipantIdentities,
}

export type GetBrandingInput = Record<string, never>

export type GetBrandingOutput = {
  brand_name: string | null
  brand_html: string | null
  favicon: string | null
}

export type GetBrandingError = 'PermissionError' | 'AuthenticationError' | 'ValidationError'

const operationGetBranding: QueryRef<GetBrandingInput, GetBrandingOutput, GetBrandingError> = {
  id: 'get_branding',
  owner: 'mail',
  kind: 'query',
  publicName: 'public.branding',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.get_branding',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetBranding,
}

export type GetSignupSettingsInput = Record<string, never>

export type GetSignupSettingsOutput = { allow_signup: 0 | 1 }

export type GetSignupSettingsError = 'PermissionError' | 'AuthenticationError' | 'ValidationError'

const operationGetSignupSettings: QueryRef<
  GetSignupSettingsInput,
  GetSignupSettingsOutput,
  GetSignupSettingsError
> = {
  id: 'get_signup_settings',
  owner: 'mail',
  kind: 'query',
  publicName: 'public.signupSettings',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.get_signup_settings',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetSignupSettings,
}

export type GetSignupDomainsInput = Record<string, never>

export type GetSignupDomainsOutput = Array<string>

export type GetSignupDomainsError = 'PermissionError' | 'AuthenticationError' | 'ValidationError'

const operationGetSignupDomains: QueryRef<
  GetSignupDomainsInput,
  GetSignupDomainsOutput,
  GetSignupDomainsError
> = {
  id: 'get_signup_domains',
  owner: 'mail',
  kind: 'query',
  publicName: 'public.signupDomains',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.get_signup_domains',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetSignupDomains,
}

export type ValidateEmailAssignedInput = { email: string }

export type ValidateEmailAssignedOutput = null

export type ValidateEmailAssignedError =
  'PermissionError' | 'AuthenticationError' | 'ValidationError'

const operationValidateEmailAssigned: QueryRef<
  ValidateEmailAssignedInput,
  ValidateEmailAssignedOutput,
  ValidateEmailAssignedError
> = {
  id: 'validate_email_assigned',
  owner: 'mail',
  kind: 'query',
  publicName: 'public.checkEmail',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.validate_email_assigned',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationValidateEmailAssigned,
}

export type SignupInput = { username: string; domain: string; email: string }

export type SignupOutput = string

export type SignupError = 'PermissionError' | 'AuthenticationError' | 'ValidationError'

const operationSignup: MutationRef<SignupInput, SignupOutput, SignupError> = {
  id: 'signup',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'public.signup',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.signup',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSignup,
}

export type ResendOtpInput = { account_request: string }

export type ResendOtpOutput = null

export type ResendOtpError = 'PermissionError' | 'AuthenticationError' | 'ValidationError'

const operationResendOtp: MutationRef<ResendOtpInput, ResendOtpOutput, ResendOtpError> = {
  id: 'resend_otp',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'public.resendCode',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.resend_otp',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationResendOtp,
}

export type VerifyOtpInput = { account_request: string; otp: string }

export type VerifyOtpOutput = string

export type VerifyOtpError = 'PermissionError' | 'AuthenticationError' | 'ValidationError'

const operationVerifyOtp: MutationRef<VerifyOtpInput, VerifyOtpOutput, VerifyOtpError> = {
  id: 'verify_otp',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'public.verifyCode',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.verify_otp',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationVerifyOtp,
}

export type GetAccountRequestOutputAccountRequest = {
  backup_email: string | null
  account: string | null
  is_verified: 0 | 1
  is_expired: 0 | 1
}

export type GetAccountRequestInput = { request_key: string }

export type GetAccountRequestOutput = GetAccountRequestOutputAccountRequest | null

export type GetAccountRequestError = 'PermissionError' | 'AuthenticationError' | 'ValidationError'

const operationGetAccountRequest: QueryRef<
  GetAccountRequestInput,
  GetAccountRequestOutput,
  GetAccountRequestError
> = {
  id: 'get_account_request',
  owner: 'mail',
  kind: 'query',
  publicName: 'public.accountRequest',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.get_account_request',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetAccountRequest,
}

export type GetAccountSetupOptionsOutputOption = { value: string; label: string }

export type GetAccountSetupOptionsInput = { request_key: string }

export type GetAccountSetupOptionsOutput = {
  locales: Array<GetAccountSetupOptionsOutputOption>
  time_zones: Array<GetAccountSetupOptionsOutputOption>
}

export type GetAccountSetupOptionsError =
  'PermissionError' | 'AuthenticationError' | 'ValidationError'

const operationGetAccountSetupOptions: QueryRef<
  GetAccountSetupOptionsInput,
  GetAccountSetupOptionsOutput,
  GetAccountSetupOptionsError
> = {
  id: 'get_account_setup_options',
  owner: 'mail',
  kind: 'query',
  publicName: 'public.accountOptions',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.get_account_setup_options',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetAccountSetupOptions,
}

export type CreateAccountInput = {
  request_key: string
  first_name: string
  last_name: string
  password: string
  locale?: string | null
  time_zone?: string | null
}

export type CreateAccountOutput = null

export type CreateAccountError = 'PermissionError' | 'AuthenticationError' | 'ValidationError'

const operationCreateAccount: MutationRef<
  CreateAccountInput,
  CreateAccountOutput,
  CreateAccountError
> = {
  id: 'create_account',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'public.createAccount',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.create_account',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationCreateAccount,
}

export type SendResetPasswordLinkInput = { user: string }

export type SendResetPasswordLinkOutput = string

export type SendResetPasswordLinkError =
  'PermissionError' | 'AuthenticationError' | 'ValidationError'

const operationSendResetPasswordLink: MutationRef<
  SendResetPasswordLinkInput,
  SendResetPasswordLinkOutput,
  SendResetPasswordLinkError
> = {
  id: 'send_reset_password_link',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'public.sendResetLink',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.send_reset_password_link',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSendResetPasswordLink,
}

export type GetUserForResetPasswordKeyInput = { key: string }

export type GetUserForResetPasswordKeyOutput = string | null

export type GetUserForResetPasswordKeyError =
  'PermissionError' | 'AuthenticationError' | 'ValidationError'

const operationGetUserForResetPasswordKey: QueryRef<
  GetUserForResetPasswordKeyInput,
  GetUserForResetPasswordKeyOutput,
  GetUserForResetPasswordKeyError
> = {
  id: 'get_user_for_reset_password_key',
  owner: 'mail',
  kind: 'query',
  publicName: 'public.resetAccount',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.get_user_for_reset_password_key',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'AuthenticationError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetUserForResetPasswordKey,
}

export type FetchAttachmentInput = { account: string; blob_id: string }

export type FetchAttachmentOutput = Blob

export type FetchAttachmentError = 'PermissionError' | 'ValidationError'

const operationFetchAttachment: QueryRef<
  FetchAttachmentInput,
  FetchAttachmentOutput,
  FetchAttachmentError
> = {
  id: 'fetch_attachment',
  owner: 'mail',
  kind: 'query',
  publicName: 'attachments.download',
  bytes: true,
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.fetch_attachment',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationFetchAttachment,
}

export type FetchAttachmentsAsZipInputZipAttachment = { blob_id: string; filename?: string | null }

export type FetchAttachmentsAsZipInput = {
  account: string
  attachments: Array<FetchAttachmentsAsZipInputZipAttachment>
}

export type FetchAttachmentsAsZipOutput = Blob

export type FetchAttachmentsAsZipError = 'PermissionError' | 'ValidationError'

const operationFetchAttachmentsAsZip: QueryRef<
  FetchAttachmentsAsZipInput,
  FetchAttachmentsAsZipOutput,
  FetchAttachmentsAsZipError
> = {
  id: 'fetch_attachments_as_zip',
  owner: 'mail',
  kind: 'query',
  publicName: 'attachments.zip',
  bytes: true,
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.fetch_attachments_as_zip',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationFetchAttachmentsAsZip,
}

export type GetMailClientConfigOutputMailClientConfig = {
  protocol: string
  hostname: string
  port: number
  connection_security: string
}

export type GetMailClientConfigInput = Record<string, never>

export type GetMailClientConfigOutput = Array<GetMailClientConfigOutputMailClientConfig>

export type GetMailClientConfigError = 'PermissionError' | 'ValidationError'

const operationGetMailClientConfig: QueryRef<
  GetMailClientConfigInput,
  GetMailClientConfigOutput,
  GetMailClientConfigError
> = {
  id: 'get_mail_client_config',
  owner: 'mail',
  kind: 'query',
  publicName: 'settings.clientConfig',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.get_mail_client_config',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetMailClientConfig,
}

export type GetQuotaInput = { account: string }

export type GetQuotaOutput = { disk_quota: number; used_quota: number; used_percentage: number }

export type GetQuotaError = 'PermissionError' | 'ValidationError'

const operationGetQuota: QueryRef<GetQuotaInput, GetQuotaOutput, GetQuotaError> = {
  id: 'get_quota',
  owner: 'mail',
  kind: 'query',
  publicName: 'settings.quota',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.get_quota',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetQuota,
}

export type SetSignatureInput = { identity: string; signature: string }

export type SetSignatureOutput = null

export type SetSignatureError = 'PermissionError' | 'ValidationError'

const operationSetSignature: MutationRef<SetSignatureInput, SetSignatureOutput, SetSignatureError> =
  {
    id: 'set_signature',
    owner: 'mail',
    kind: 'mutation',
    publicName: 'identities.setSignature',
    empty: true,
    envelope: 'message',
    method: 'POST',
    path: '/api/method/suite.mail.api.account.set_signature',
    prefix: '/api/suite/mail/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: ['PermissionError', 'ValidationError'],
    loadValidators: async () => (await import('./validators')).operationSetSignature,
  }

export type CreateMailboxInputAutomationRules = {
  emails_from: string
  subject_contains: string
  match_if: 'any' | 'all'
  mark_as_read: boolean | (0 | 1)
  add_star: boolean | (0 | 1)
}

export type CreateMailboxInput = {
  account: string
  name: string
  parent?: string | null
  icon?: string | null
  color?: string | null
  disable_push_notification?: boolean
  automation_rules?: CreateMailboxInputAutomationRules | null
}

export type CreateMailboxOutput = string

export type CreateMailboxError = 'PermissionError' | 'ValidationError'

const operationCreateMailbox: MutationRef<
  CreateMailboxInput,
  CreateMailboxOutput,
  CreateMailboxError
> = {
  id: 'create_mailbox',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'mailboxes.create',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.create_mailbox',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationCreateMailbox,
}

export type UpdateMailboxInputAutomationRules = {
  emails_from: string
  subject_contains: string
  match_if: 'any' | 'all'
  mark_as_read: boolean | (0 | 1)
  add_star: boolean | (0 | 1)
}

export type UpdateMailboxInput = {
  account: string
  name: string
  parent?: string | null
  icon?: string | null
  color?: string | null
  disable_push_notification?: boolean
  automation_rules?: UpdateMailboxInputAutomationRules | null
  id: string
  old_name: string
  role?: string | null
}

export type UpdateMailboxOutput = null

export type UpdateMailboxError = 'PermissionError' | 'ValidationError'

const operationUpdateMailbox: MutationRef<
  UpdateMailboxInput,
  UpdateMailboxOutput,
  UpdateMailboxError
> = {
  id: 'update_mailbox',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'mailboxes.update',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.update_mailbox',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationUpdateMailbox,
}

export type DeleteMailboxInput = { account: string; id: string; name: string }

export type DeleteMailboxOutput = null

export type DeleteMailboxError = 'PermissionError' | 'ValidationError'

const operationDeleteMailbox: MutationRef<
  DeleteMailboxInput,
  DeleteMailboxOutput,
  DeleteMailboxError
> = {
  id: 'delete_mailbox',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'mailboxes.delete',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.delete_mailbox',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteMailbox,
}

export type ScreenEmailAddressInput = {
  account: string
  email: string
  action?: 'Spam' | 'Accepted'
}

export type ScreenEmailAddressOutput = null

export type ScreenEmailAddressError = 'PermissionError' | 'ValidationError'

const operationScreenEmailAddress: MutationRef<
  ScreenEmailAddressInput,
  ScreenEmailAddressOutput,
  ScreenEmailAddressError
> = {
  id: 'screen_email_address',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'screening.setAddress',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.screen_email_address',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationScreenEmailAddress,
}

export type CreateSieveScriptInput = {
  account: string
  _name: string
  content: string
  active: boolean
}

export type CreateSieveScriptOutput = null

export type CreateSieveScriptError = 'PermissionError' | 'ValidationError'

const operationCreateSieveScript: MutationRef<
  CreateSieveScriptInput,
  CreateSieveScriptOutput,
  CreateSieveScriptError
> = {
  id: 'create_sieve_script',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'sieve.create',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.sieve.create_sieve_script',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationCreateSieveScript,
}

export type UpdateSieveScriptInput = {
  account: string
  _name: string
  content: string
  active: boolean
  id: string
}

export type UpdateSieveScriptOutput = null

export type UpdateSieveScriptError = 'PermissionError' | 'ValidationError'

const operationUpdateSieveScript: MutationRef<
  UpdateSieveScriptInput,
  UpdateSieveScriptOutput,
  UpdateSieveScriptError
> = {
  id: 'update_sieve_script',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'sieve.update',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.sieve.update_sieve_script',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationUpdateSieveScript,
}

export type DeleteSieveScriptInput = { account: string; id: string }

export type DeleteSieveScriptOutput = null

export type DeleteSieveScriptError = 'PermissionError' | 'ValidationError'

const operationDeleteSieveScript: MutationRef<
  DeleteSieveScriptInput,
  DeleteSieveScriptOutput,
  DeleteSieveScriptError
> = {
  id: 'delete_sieve_script',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'sieve.delete',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.sieve.delete_sieve_script',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteSieveScript,
}

export type CreateAutomationScriptInput = { account: string; active?: boolean }

export type CreateAutomationScriptOutput = null

export type CreateAutomationScriptError = 'PermissionError' | 'ValidationError'

const operationCreateAutomationScript: MutationRef<
  CreateAutomationScriptInput,
  CreateAutomationScriptOutput,
  CreateAutomationScriptError
> = {
  id: 'create_automation_script',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'sieve.createAutomation',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.sieve.create_automation_script',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationCreateAutomationScript,
}

export type RebuildAutomationScriptForAccountInput = { account: string }

export type RebuildAutomationScriptForAccountOutput = null

export type RebuildAutomationScriptForAccountError = 'PermissionError' | 'ValidationError'

const operationRebuildAutomationScriptForAccount: MutationRef<
  RebuildAutomationScriptForAccountInput,
  RebuildAutomationScriptForAccountOutput,
  RebuildAutomationScriptForAccountError
> = {
  id: 'rebuild_automation_script_for_account',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'sieve.rebuildAutomation',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.sieve.rebuild_automation_script_for_account',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () =>
    (await import('./validators')).operationRebuildAutomationScriptForAccount,
}

export type GetVacationResponseInput = { account: string }

export type GetVacationResponseOutput = {
  account: string
  enabled: boolean | (0 | 1)
  from_date: string | null
  to_date: string | null
  subject: string | null
  text_body: string | null
  html_body: string | null
  creation: string | null
  modified: string | null
}

export type GetVacationResponseError = 'PermissionError' | 'ValidationError'

const operationGetVacationResponse: QueryRef<
  GetVacationResponseInput,
  GetVacationResponseOutput,
  GetVacationResponseError
> = {
  id: 'get_vacation_response',
  owner: 'mail',
  kind: 'query',
  publicName: 'vacation.get',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.vacation_response.vacation_response.get_vacation_response',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetVacationResponse,
}

export type UpdateVacationResponseInput = {
  account: string
  enabled: boolean | (0 | 1)
  from_date?: string | null
  to_date?: string | null
  subject?: string | null
  text_body?: string | null
  html_body?: string | null
}

export type UpdateVacationResponseOutput = null

export type UpdateVacationResponseError = 'PermissionError' | 'ValidationError'

const operationUpdateVacationResponse: MutationRef<
  UpdateVacationResponseInput,
  UpdateVacationResponseOutput,
  UpdateVacationResponseError
> = {
  id: 'update_vacation_response',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'vacation.update',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.vacation_response.vacation_response.update_vacation_response',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationUpdateVacationResponse,
}

export type CreateMailImportInput = {
  account: string
  format: 'eml' | 'jmap' | 'mbox' | 'maildir' | 'maildir-nested'
  file: string
  mailbox?: string | null
  seen?: boolean
}

export type CreateMailImportOutput = null

export type CreateMailImportError = 'PermissionError' | 'ValidationError'

const operationCreateMailImport: MutationRef<
  CreateMailImportInput,
  CreateMailImportOutput,
  CreateMailImportError
> = {
  id: 'create_mail_import',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'exchanges.importMail',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.create_mail_import',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationCreateMailImport,
}

export type CreateMailExportInputMailFilter = {
  inMailbox?: string
  after?: string
  before?: string
  hasAttachment?: string | boolean
  isRead?: string | boolean
}

export type CreateMailExportInput = {
  account: string
  format: 'jmap' | 'mbox' | 'maildir' | 'maildir-nested'
  archive_type: '.zip' | '.tgz' | '.tar.gz'
  sort: 'Received At (ASC)' | 'Received At (DESC)'
  limit?: number | null
  filter?: CreateMailExportInputMailFilter | null
}

export type CreateMailExportOutput = null

export type CreateMailExportError = 'PermissionError' | 'ValidationError'

const operationCreateMailExport: MutationRef<
  CreateMailExportInput,
  CreateMailExportOutput,
  CreateMailExportError
> = {
  id: 'create_mail_export',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'exchanges.exportMail',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.create_mail_export',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationCreateMailExport,
}

export type CreateContactsImportInput = {
  account: string
  format: 'vcf' | 'jmap'
  file: string
  address_book?: string | null
}

export type CreateContactsImportOutput = null

export type CreateContactsImportError = 'PermissionError' | 'ValidationError'

const operationCreateContactsImport: MutationRef<
  CreateContactsImportInput,
  CreateContactsImportOutput,
  CreateContactsImportError
> = {
  id: 'create_contacts_import',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'exchanges.importContacts',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.create_contacts_import',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationCreateContactsImport,
}

export type CreateContactsExportInputContactsFilter = {
  inAddressBook?: string
  name?: string
  email?: string
}

export type CreateContactsExportInput = {
  account: string
  format: 'jmap' | 'vcf'
  archive_type: '.zip' | '.tgz' | '.tar.gz'
  limit?: number | null
  filter?: CreateContactsExportInputContactsFilter | null
}

export type CreateContactsExportOutput = null

export type CreateContactsExportError = 'PermissionError' | 'ValidationError'

const operationCreateContactsExport: MutationRef<
  CreateContactsExportInput,
  CreateContactsExportOutput,
  CreateContactsExportError
> = {
  id: 'create_contacts_export',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'exchanges.exportContacts',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.account.create_contacts_export',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationCreateContactsExport,
}

export type OngoingExchangeInputExchangeFilters = {
  user: string
  account?: string
  operation: 'Import' | 'Export'
  status: ['in', Array<'Queued' | 'In Progress'>]
}

export type OngoingExchangeOutputExchangeName = { name?: string }

export type OngoingExchangeInput = {
  doctype: 'Mail Exchange' | 'Contacts Exchange' | 'Calendar Exchange'
  fieldname: 'name'
  filters: OngoingExchangeInputExchangeFilters
}

export type OngoingExchangeOutput = OngoingExchangeOutputExchangeName | null

export type OngoingExchangeError = 'PermissionError'

const operationOngoingExchange: QueryRef<
  OngoingExchangeInput,
  OngoingExchangeOutput,
  OngoingExchangeError
> = {
  id: 'ongoing_exchange',
  owner: 'mail',
  kind: 'query',
  publicName: 'exchanges.ongoing',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/frappe.client.get_value',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError'],
  loadValidators: async () => (await import('./validators')).operationOngoingExchange,
}

export type AddDomainInput = { name: string; description?: string | null }

export type AddDomainOutput = string

export type AddDomainError = 'PermissionError' | 'ValidationError'

const operationAddDomain: MutationRef<AddDomainInput, AddDomainOutput, AddDomainError> = {
  id: 'add_domain',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.domains.create',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.add_domain',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddDomain,
}

export type AddGroupInput = {
  name: string
  domain: string
  description?: string | null
  members?: Array<string> | null
  quota_gb?: number | null
  disable_receiving?: boolean
}

export type AddGroupOutput = string

export type AddGroupError = 'PermissionError' | 'ValidationError'

const operationAddGroup: MutationRef<AddGroupInput, AddGroupOutput, AddGroupError> = {
  id: 'add_group',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.groups.create',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.add_group',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddGroup,
}

export type AddGroupEmailInput = { group_id: string; email: string; description?: string | null }

export type AddGroupEmailOutput = null

export type AddGroupEmailError = 'PermissionError' | 'ValidationError'

const operationAddGroupEmail: MutationRef<
  AddGroupEmailInput,
  AddGroupEmailOutput,
  AddGroupEmailError
> = {
  id: 'add_group_email',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.groups.addEmail',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.add_group_email',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddGroupEmail,
}

export type AddGroupMembersInput = { group_id: string; account_ids: Array<string> }

export type AddGroupMembersOutput = null

export type AddGroupMembersError = 'PermissionError' | 'ValidationError'

const operationAddGroupMembers: MutationRef<
  AddGroupMembersInput,
  AddGroupMembersOutput,
  AddGroupMembersError
> = {
  id: 'add_group_members',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.groups.addMembers',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.add_group_members',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddGroupMembers,
}

export type AddMailingListInput = {
  name: string
  domain: string
  recipients?: Array<string> | null
  description?: string | null
}

export type AddMailingListOutput = string

export type AddMailingListError = 'PermissionError' | 'ValidationError'

const operationAddMailingList: MutationRef<
  AddMailingListInput,
  AddMailingListOutput,
  AddMailingListError
> = {
  id: 'add_mailing_list',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.mailingLists.create',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.add_mailing_list',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddMailingList,
}

export type AddMailingListEmailInput = {
  list_id: string
  email: string
  description?: string | null
}

export type AddMailingListEmailOutput = null

export type AddMailingListEmailError = 'PermissionError' | 'ValidationError'

const operationAddMailingListEmail: MutationRef<
  AddMailingListEmailInput,
  AddMailingListEmailOutput,
  AddMailingListEmailError
> = {
  id: 'add_mailing_list_email',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.mailingLists.addEmail',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.add_mailing_list_email',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddMailingListEmail,
}

export type AddMailingListRecipientsInput = { list_id: string; recipients: Array<string> }

export type AddMailingListRecipientsOutput = null

export type AddMailingListRecipientsError = 'PermissionError' | 'ValidationError'

const operationAddMailingListRecipients: MutationRef<
  AddMailingListRecipientsInput,
  AddMailingListRecipientsOutput,
  AddMailingListRecipientsError
> = {
  id: 'add_mailing_list_recipients',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.mailingLists.addRecipients',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.add_mailing_list_recipients',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddMailingListRecipients,
}

export type AddMemberInput = {
  username: string
  domain: string
  is_admin: boolean
  send_invite: boolean
  backup_email: string
  first_name?: string | null
  last_name?: string | null
  password?: string | null
  expires_at?: string | null
  aliases?: Array<string> | null
  groups?: Array<string> | null
  mailing_lists?: Array<string> | null
  quota_gb?: number | null
  locale?: string | null
  time_zone?: string | null
  disable_receiving?: boolean
}

export type AddMemberOutput = {
  success: boolean
  user: string
  status: string
  error: string | null
  temporary_password: string | null
  expires_at: string | null
}

export type AddMemberError = 'PermissionError' | 'ValidationError'

const operationAddMember: MutationRef<AddMemberInput, AddMemberOutput, AddMemberError> = {
  id: 'add_member',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.members.create',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.add_member',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddMember,
}

export type AddMemberEmailInput = { member_id: string; email: string; description?: string | null }

export type AddMemberEmailOutput = null

export type AddMemberEmailError = 'PermissionError' | 'ValidationError'

const operationAddMemberEmail: MutationRef<
  AddMemberEmailInput,
  AddMemberEmailOutput,
  AddMemberEmailError
> = {
  id: 'add_member_email',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.members.addEmail',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.add_member_email',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddMemberEmail,
}

export type AddMemberToGroupsInput = { member_id: string; group_ids: Array<string> }

export type AddMemberToGroupsOutput = null

export type AddMemberToGroupsError = 'PermissionError' | 'ValidationError'

const operationAddMemberToGroups: MutationRef<
  AddMemberToGroupsInput,
  AddMemberToGroupsOutput,
  AddMemberToGroupsError
> = {
  id: 'add_member_to_groups',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.groups.addMemberToGroups',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.add_member_to_groups',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddMemberToGroups,
}

export type AddMemberToMailingListsInput = { member_id: string; list_ids: Array<string> }

export type AddMemberToMailingListsOutput = null

export type AddMemberToMailingListsError = 'PermissionError' | 'ValidationError'

const operationAddMemberToMailingLists: MutationRef<
  AddMemberToMailingListsInput,
  AddMemberToMailingListsOutput,
  AddMemberToMailingListsError
> = {
  id: 'add_member_to_mailing_lists',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.mailingLists.addMemberToMailingLists',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.add_member_to_mailing_lists',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddMemberToMailingLists,
}

export type ChangeMemberPasswordInput = { member_id: string; new_password: string }

export type ChangeMemberPasswordOutput = null

export type ChangeMemberPasswordError = 'PermissionError' | 'ValidationError'

const operationChangeMemberPassword: MutationRef<
  ChangeMemberPasswordInput,
  ChangeMemberPasswordOutput,
  ChangeMemberPasswordError
> = {
  id: 'change_member_password',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.members.changePassword',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.change_member_password',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationChangeMemberPassword,
}

export type DeleteAccountRequestsInput = { names: Array<string> }

export type DeleteAccountRequestsOutput = null

export type DeleteAccountRequestsError = 'PermissionError' | 'ValidationError'

const operationDeleteAccountRequests: MutationRef<
  DeleteAccountRequestsInput,
  DeleteAccountRequestsOutput,
  DeleteAccountRequestsError
> = {
  id: 'delete_account_requests',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.members.deleteAccountRequests',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.delete_account_requests',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteAccountRequests,
}

export type DeleteDomainInput = { domain_id: string }

export type DeleteDomainOutput = null

export type DeleteDomainError = 'PermissionError' | 'ValidationError'

const operationDeleteDomain: MutationRef<DeleteDomainInput, DeleteDomainOutput, DeleteDomainError> =
  {
    id: 'delete_domain',
    owner: 'mail',
    kind: 'mutation',
    publicName: 'admin.domains.delete',
    empty: true,
    envelope: 'message',
    method: 'POST',
    path: '/api/method/suite.mail.api.admin.delete_domain',
    prefix: '/api/suite/mail/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: ['PermissionError', 'ValidationError'],
    loadValidators: async () => (await import('./validators')).operationDeleteDomain,
  }

export type DeleteGroupsInput = { ids: Array<string> }

export type DeleteGroupsOutput = null

export type DeleteGroupsError = 'PermissionError' | 'ValidationError'

const operationDeleteGroups: MutationRef<DeleteGroupsInput, DeleteGroupsOutput, DeleteGroupsError> =
  {
    id: 'delete_groups',
    owner: 'mail',
    kind: 'mutation',
    publicName: 'admin.groups.delete',
    empty: true,
    envelope: 'message',
    method: 'POST',
    path: '/api/method/suite.mail.api.admin.delete_groups',
    prefix: '/api/suite/mail/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: ['PermissionError', 'ValidationError'],
    loadValidators: async () => (await import('./validators')).operationDeleteGroups,
  }

export type DeleteMailingListsInput = { ids: Array<string> }

export type DeleteMailingListsOutput = null

export type DeleteMailingListsError = 'PermissionError' | 'ValidationError'

const operationDeleteMailingLists: MutationRef<
  DeleteMailingListsInput,
  DeleteMailingListsOutput,
  DeleteMailingListsError
> = {
  id: 'delete_mailing_lists',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.mailingLists.delete',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.delete_mailing_lists',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteMailingLists,
}

export type DeleteMembersInput = { names: Array<string>; confirmation?: string }

export type DeleteMembersOutput = null

export type DeleteMembersError = 'PermissionError' | 'ValidationError'

const operationDeleteMembers: MutationRef<
  DeleteMembersInput,
  DeleteMembersOutput,
  DeleteMembersError
> = {
  id: 'delete_members',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.members.delete',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.delete_members',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteMembers,
}

export type DisableMembersInput = { names: Array<string> }

export type DisableMembersOutput = null

export type DisableMembersError = 'PermissionError' | 'ValidationError'

const operationDisableMembers: MutationRef<
  DisableMembersInput,
  DisableMembersOutput,
  DisableMembersError
> = {
  id: 'disable_members',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.members.disable',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.disable_members',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDisableMembers,
}

export type EnableMembersInput = { names: Array<string> }

export type EnableMembersOutput = null

export type EnableMembersError = 'PermissionError' | 'ValidationError'

const operationEnableMembers: MutationRef<
  EnableMembersInput,
  EnableMembersOutput,
  EnableMembersError
> = {
  id: 'enable_members',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.members.enable',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.enable_members',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationEnableMembers,
}

export type GetAccountOptionsOutputOption = { value: string; label: string }

export type GetAccountOptionsInput = Record<string, never>

export type GetAccountOptionsOutput = {
  locales: Array<GetAccountOptionsOutputOption>
  time_zones: Array<GetAccountOptionsOutputOption>
}

export type GetAccountOptionsError = 'PermissionError' | 'ValidationError'

const operationGetAccountOptions: QueryRef<
  GetAccountOptionsInput,
  GetAccountOptionsOutput,
  GetAccountOptionsError
> = {
  id: 'get_account_options',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.members.options',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_account_options',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetAccountOptions,
}

export type GetAccountsOutputAddressRef = { id: string; name: string; email: string }

export type GetAccountsInput = { search?: string | null; limit?: number }

export type GetAccountsOutput = Array<GetAccountsOutputAddressRef>

export type GetAccountsError = 'PermissionError' | 'ValidationError'

const operationGetAccounts: QueryRef<GetAccountsInput, GetAccountsOutput, GetAccountsError> = {
  id: 'get_accounts',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.members.accounts',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_accounts',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetAccounts,
}

export type GetDomainOutputDnsGroup = {
  key: string
  label: string
  description: string
  is_mandatory: boolean
}

export type GetDomainOutputDnsRecord = {
  type: string | null
  host: string
  fqdn: string | null
  value: string
  priority: number | null
  weight: number | null
  port: number | null
  ttl: number | null
  category: string | null
  group: string | null
  is_mandatory: boolean
  is_verified: boolean
  last_checked_at: string | null
}

export type GetDomainInput = { domain_id: string }

export type GetDomainOutput = {
  id: string
  name: string
  description: string
  status: 'Active' | 'Pending Verification' | 'Disabled'
  is_enabled: boolean
  catch_all_address: string
  sub_addressing: boolean
  allow_relaying: boolean
  is_verified: boolean
  last_verified_at: string | null
  created_at: string | null
  dns_record_groups: Array<GetDomainOutputDnsGroup>
  dns_records: Array<GetDomainOutputDnsRecord>
}

export type GetDomainError = 'PermissionError' | 'ValidationError'

const operationGetDomain: QueryRef<GetDomainInput, GetDomainOutput, GetDomainError> = {
  id: 'get_domain',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.domains.get',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_domain',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetDomain,
}

export type GetDomainDnsCsvInput = { domain_id: string }

export type GetDomainDnsCsvOutput = string

export type GetDomainDnsCsvError = 'PermissionError' | 'ValidationError'

const operationGetDomainDnsCsv: QueryRef<
  GetDomainDnsCsvInput,
  GetDomainDnsCsvOutput,
  GetDomainDnsCsvError
> = {
  id: 'get_domain_dns_csv',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.domains.dnsCsv',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_domain_dns_csv',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetDomainDnsCsv,
}

export type GetDomainDnsJsonInput = { domain_id: string }

export type GetDomainDnsJsonOutput = string

export type GetDomainDnsJsonError = 'PermissionError' | 'ValidationError'

const operationGetDomainDnsJson: QueryRef<
  GetDomainDnsJsonInput,
  GetDomainDnsJsonOutput,
  GetDomainDnsJsonError
> = {
  id: 'get_domain_dns_json',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.domains.dnsJson',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_domain_dns_json',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetDomainDnsJson,
}

export type GetDomainDnsZoneInput = { domain_id: string }

export type GetDomainDnsZoneOutput = string

export type GetDomainDnsZoneError = 'PermissionError' | 'ValidationError'

const operationGetDomainDnsZone: QueryRef<
  GetDomainDnsZoneInput,
  GetDomainDnsZoneOutput,
  GetDomainDnsZoneError
> = {
  id: 'get_domain_dns_zone',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.domains.dnsZone',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_domain_dns_zone',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetDomainDnsZone,
}

export type GetDomainOwnershipRecordOutputOwnershipRecord = {
  type: string
  host: string
  fqdn: string
  value: string
}

export type GetDomainOwnershipRecordInput = { name: string }

export type GetDomainOwnershipRecordOutput = {
  domain: string
  ownership_record: GetDomainOwnershipRecordOutputOwnershipRecord
}

export type GetDomainOwnershipRecordError = 'PermissionError' | 'ValidationError'

const operationGetDomainOwnershipRecord: QueryRef<
  GetDomainOwnershipRecordInput,
  GetDomainOwnershipRecordOutput,
  GetDomainOwnershipRecordError
> = {
  id: 'get_domain_ownership_record',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.domains.ownershipRecord',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_domain_ownership_record',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetDomainOwnershipRecord,
}

export type GetEnabledDomainsInput = Record<string, never>

export type GetEnabledDomainsOutput = Array<string>

export type GetEnabledDomainsError = 'PermissionError' | 'ValidationError'

const operationGetEnabledDomains: QueryRef<
  GetEnabledDomainsInput,
  GetEnabledDomainsOutput,
  GetEnabledDomainsError
> = {
  id: 'get_enabled_domains',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.domains.enabled',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_enabled_domains',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetEnabledDomains,
}

export type GetGroupOutputAddress = {
  email: string
  description: string | null
  is_primary: boolean
  enabled: boolean
}

export type GetGroupOutputAddressRef = { id: string; name: string; email: string }

export type GetGroupOutputQuota = {
  total: number
  used: number
  available: number
  used_percentage: number
  available_percentage: number
  unlimited: boolean
}

export type GetGroupInput = { group_id: string }

export type GetGroupOutput = {
  id: string
  name: string
  email: string
  description: string | null
  disable_receiving: boolean
  quota_gb: number
  used_bytes: number | null
  created_at: string | null
  email_addresses: Array<GetGroupOutputAddress>
  members: Array<GetGroupOutputAddressRef>
  quota: GetGroupOutputQuota
}

export type GetGroupError = 'PermissionError' | 'ValidationError'

const operationGetGroup: QueryRef<GetGroupInput, GetGroupOutput, GetGroupError> = {
  id: 'get_group',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.groups.get',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_group',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetGroup,
}

export type GetMailingListOutputAddress = {
  email: string
  description: string | null
  is_primary: boolean
  enabled: boolean
}

export type GetMailingListOutputRecipientRow = { email: string; enabled: boolean }

export type GetMailingListInput = {
  list_id: string
  start?: number
  limit?: number
  search?: string | null
}

export type GetMailingListOutput = {
  id: string
  name: string
  email: string
  description: string | null
  recipient_count: number
  email_addresses: Array<GetMailingListOutputAddress>
  recipients: Array<string>
  recipient_rows: Array<GetMailingListOutputRecipientRow>
  recipient_total: number
}

export type GetMailingListError = 'PermissionError' | 'ValidationError'

const operationGetMailingList: QueryRef<
  GetMailingListInput,
  GetMailingListOutput,
  GetMailingListError
> = {
  id: 'get_mailing_list',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.mailingLists.get',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_mailing_list',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetMailingList,
}

export type GetMemberOutputAddress = {
  email: string
  description: string | null
  is_primary: boolean
  enabled: boolean
}

export type GetMemberOutputAddressRef = { id: string; name: string; email: string }

export type GetMemberOutputQuota = {
  total: number
  used: number
  available: number
  used_percentage: number
  available_percentage: number
  unlimited: boolean
}

export type GetMemberInput = { member_id: string }

export type GetMemberOutput = {
  name: string
  full_name: string
  user_image: string
  description: string
  last_active: string | null
  joined_on: string | null
  enabled: boolean
  is_admin: boolean
  account: string | null
  email_addresses: Array<GetMemberOutputAddress>
  groups: Array<GetMemberOutputAddressRef>
  mailing_lists: Array<GetMemberOutputAddressRef>
  quota: GetMemberOutputQuota
  locale: string | null
  time_zone: string | null
  disable_receiving: boolean
}

export type GetMemberError = 'PermissionError' | 'ValidationError'

const operationGetMember: QueryRef<GetMemberInput, GetMemberOutput, GetMemberError> = {
  id: 'get_member',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.members.get',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_member',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetMember,
}

export type RemoveGroupEmailInput = { group_id: string; email: string }

export type RemoveGroupEmailOutput = null

export type RemoveGroupEmailError = 'PermissionError' | 'ValidationError'

const operationRemoveGroupEmail: MutationRef<
  RemoveGroupEmailInput,
  RemoveGroupEmailOutput,
  RemoveGroupEmailError
> = {
  id: 'remove_group_email',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.groups.removeEmail',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.remove_group_email',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationRemoveGroupEmail,
}

export type RemoveGroupMemberInput = { group_id: string; account_id: string }

export type RemoveGroupMemberOutput = null

export type RemoveGroupMemberError = 'PermissionError' | 'ValidationError'

const operationRemoveGroupMember: MutationRef<
  RemoveGroupMemberInput,
  RemoveGroupMemberOutput,
  RemoveGroupMemberError
> = {
  id: 'remove_group_member',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.groups.removeMember',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.remove_group_member',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationRemoveGroupMember,
}

export type RemoveMailingListEmailInput = { list_id: string; email: string }

export type RemoveMailingListEmailOutput = null

export type RemoveMailingListEmailError = 'PermissionError' | 'ValidationError'

const operationRemoveMailingListEmail: MutationRef<
  RemoveMailingListEmailInput,
  RemoveMailingListEmailOutput,
  RemoveMailingListEmailError
> = {
  id: 'remove_mailing_list_email',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.mailingLists.removeEmail',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.remove_mailing_list_email',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationRemoveMailingListEmail,
}

export type RemoveMailingListRecipientInput = { list_id: string; email: string }

export type RemoveMailingListRecipientOutput = null

export type RemoveMailingListRecipientError = 'PermissionError' | 'ValidationError'

const operationRemoveMailingListRecipient: MutationRef<
  RemoveMailingListRecipientInput,
  RemoveMailingListRecipientOutput,
  RemoveMailingListRecipientError
> = {
  id: 'remove_mailing_list_recipient',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.mailingLists.removeRecipient',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.remove_mailing_list_recipient',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationRemoveMailingListRecipient,
}

export type RemoveMemberEmailInput = { member_id: string; email: string }

export type RemoveMemberEmailOutput = null

export type RemoveMemberEmailError = 'PermissionError' | 'ValidationError'

const operationRemoveMemberEmail: MutationRef<
  RemoveMemberEmailInput,
  RemoveMemberEmailOutput,
  RemoveMemberEmailError
> = {
  id: 'remove_member_email',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.members.removeEmail',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.remove_member_email',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationRemoveMemberEmail,
}

export type RemoveMemberFromGroupInput = { member_id: string; group_id: string }

export type RemoveMemberFromGroupOutput = null

export type RemoveMemberFromGroupError = 'PermissionError' | 'ValidationError'

const operationRemoveMemberFromGroup: MutationRef<
  RemoveMemberFromGroupInput,
  RemoveMemberFromGroupOutput,
  RemoveMemberFromGroupError
> = {
  id: 'remove_member_from_group',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.groups.removeMemberFromGroup',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.remove_member_from_group',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationRemoveMemberFromGroup,
}

export type RemoveMemberFromMailingListInput = { member_id: string; list_id: string }

export type RemoveMemberFromMailingListOutput = null

export type RemoveMemberFromMailingListError = 'PermissionError' | 'ValidationError'

const operationRemoveMemberFromMailingList: MutationRef<
  RemoveMemberFromMailingListInput,
  RemoveMemberFromMailingListOutput,
  RemoveMemberFromMailingListError
> = {
  id: 'remove_member_from_mailing_list',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.mailingLists.removeMemberFromMailingList',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.remove_member_from_mailing_list',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationRemoveMemberFromMailingList,
}

export type SetDomainEnabledInput = { domain_id: string; enabled: boolean }

export type SetDomainEnabledOutput = {
  id: string
  name: string
  description: string
  status: 'Active' | 'Pending Verification' | 'Disabled'
  is_enabled: boolean
  catch_all_address: string
  sub_addressing: boolean
  allow_relaying: boolean
  is_verified: boolean
  last_verified_at: string | null
  created_at: string | null
}

export type SetDomainEnabledError = 'PermissionError' | 'ValidationError'

const operationSetDomainEnabled: MutationRef<
  SetDomainEnabledInput,
  SetDomainEnabledOutput,
  SetDomainEnabledError
> = {
  id: 'set_domain_enabled',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.domains.setEnabled',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.set_domain_enabled',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSetDomainEnabled,
}

export type SetGroupEmailEnabledInput = { group_id: string; email: string; enabled: number }

export type SetGroupEmailEnabledOutput = null

export type SetGroupEmailEnabledError = 'PermissionError' | 'ValidationError'

const operationSetGroupEmailEnabled: MutationRef<
  SetGroupEmailEnabledInput,
  SetGroupEmailEnabledOutput,
  SetGroupEmailEnabledError
> = {
  id: 'set_group_email_enabled',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.groups.setEmailEnabled',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.set_group_email_enabled',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSetGroupEmailEnabled,
}

export type SetGroupReceivingEnabledInput = { group_id: string; enabled: boolean }

export type SetGroupReceivingEnabledOutput = null

export type SetGroupReceivingEnabledError = 'PermissionError' | 'ValidationError'

const operationSetGroupReceivingEnabled: MutationRef<
  SetGroupReceivingEnabledInput,
  SetGroupReceivingEnabledOutput,
  SetGroupReceivingEnabledError
> = {
  id: 'set_group_receiving_enabled',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.groups.setReceivingEnabled',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.set_group_receiving_enabled',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSetGroupReceivingEnabled,
}

export type SetMailingListEmailEnabledInput = { list_id: string; email: string; enabled: number }

export type SetMailingListEmailEnabledOutput = null

export type SetMailingListEmailEnabledError = 'PermissionError' | 'ValidationError'

const operationSetMailingListEmailEnabled: MutationRef<
  SetMailingListEmailEnabledInput,
  SetMailingListEmailEnabledOutput,
  SetMailingListEmailEnabledError
> = {
  id: 'set_mailing_list_email_enabled',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.mailingLists.setEmailEnabled',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.set_mailing_list_email_enabled',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSetMailingListEmailEnabled,
}

export type SetMemberEmailEnabledInput = { member_id: string; email: string; enabled: number }

export type SetMemberEmailEnabledOutput = null

export type SetMemberEmailEnabledError = 'PermissionError' | 'ValidationError'

const operationSetMemberEmailEnabled: MutationRef<
  SetMemberEmailEnabledInput,
  SetMemberEmailEnabledOutput,
  SetMemberEmailEnabledError
> = {
  id: 'set_member_email_enabled',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.members.setEmailEnabled',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.set_member_email_enabled',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSetMemberEmailEnabled,
}

export type SetMemberReceivingEnabledInput = { member_id: string; enabled: boolean }

export type SetMemberReceivingEnabledOutput = null

export type SetMemberReceivingEnabledError = 'PermissionError' | 'ValidationError'

const operationSetMemberReceivingEnabled: MutationRef<
  SetMemberReceivingEnabledInput,
  SetMemberReceivingEnabledOutput,
  SetMemberReceivingEnabledError
> = {
  id: 'set_member_receiving_enabled',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.members.setReceivingEnabled',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.set_member_receiving_enabled',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSetMemberReceivingEnabled,
}

export type UpdateDomainOutputDnsGroup = {
  key: string
  label: string
  description: string
  is_mandatory: boolean
}

export type UpdateDomainOutputDnsRecord = {
  type: string | null
  host: string
  fqdn: string | null
  value: string
  priority: number | null
  weight: number | null
  port: number | null
  ttl: number | null
  category: string | null
  group: string | null
  is_mandatory: boolean
  is_verified: boolean
  last_checked_at: string | null
}

export type UpdateDomainOutputDomain = {
  id: string
  name: string
  description: string
  status: 'Active' | 'Pending Verification' | 'Disabled'
  is_enabled: boolean
  catch_all_address: string
  sub_addressing: boolean
  allow_relaying: boolean
  is_verified: boolean
  last_verified_at: string | null
  created_at: string | null
  dns_record_groups: Array<UpdateDomainOutputDnsGroup>
  dns_records: Array<UpdateDomainOutputDnsRecord>
}

export type UpdateDomainOutputDomainRow = {
  id: string
  name: string
  description: string
  status: 'Active' | 'Pending Verification' | 'Disabled'
  is_enabled: boolean
  catch_all_address: string
  sub_addressing: boolean
  allow_relaying: boolean
  is_verified: boolean
  last_verified_at: string | null
  created_at: string | null
}

export type UpdateDomainInput = {
  domain_id: string
  description?: string | null
  catch_all_address?: string | null
  sub_addressing?: boolean | null
  allow_relaying?: boolean | null
}

export type UpdateDomainOutput = UpdateDomainOutputDomainRow | UpdateDomainOutputDomain

export type UpdateDomainError = 'PermissionError' | 'ValidationError'

const operationUpdateDomain: MutationRef<UpdateDomainInput, UpdateDomainOutput, UpdateDomainError> =
  {
    id: 'update_domain',
    owner: 'mail',
    kind: 'mutation',
    publicName: 'admin.domains.update',
    envelope: 'message',
    method: 'POST',
    path: '/api/method/suite.mail.api.admin.update_domain',
    prefix: '/api/suite/mail/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: ['PermissionError', 'ValidationError'],
    loadValidators: async () => (await import('./validators')).operationUpdateDomain,
  }

export type UpdateGroupInput = {
  group_id: string
  description?: string | null
  quota_gb?: number | null
}

export type UpdateGroupOutput = null

export type UpdateGroupError = 'PermissionError' | 'ValidationError'

const operationUpdateGroup: MutationRef<UpdateGroupInput, UpdateGroupOutput, UpdateGroupError> = {
  id: 'update_group',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.groups.update',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.update_group',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationUpdateGroup,
}

export type UpdateMailingListInput = { list_id: string; description?: string | null }

export type UpdateMailingListOutput = null

export type UpdateMailingListError = 'PermissionError' | 'ValidationError'

const operationUpdateMailingList: MutationRef<
  UpdateMailingListInput,
  UpdateMailingListOutput,
  UpdateMailingListError
> = {
  id: 'update_mailing_list',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'admin.mailingLists.update',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.update_mailing_list',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationUpdateMailingList,
}

export type UpdateMemberInput = {
  member_id: string
  role?: string | null
  description?: string | null
  quota_gb?: number | null
  locale?: string | null
  time_zone?: string | null
}

export type UpdateMemberOutput = null

export type UpdateMemberError = 'PermissionError' | 'ValidationError'

const operationUpdateMember: MutationRef<UpdateMemberInput, UpdateMemberOutput, UpdateMemberError> =
  {
    id: 'update_member',
    owner: 'mail',
    kind: 'mutation',
    publicName: 'admin.members.update',
    empty: true,
    envelope: 'message',
    method: 'POST',
    path: '/api/method/suite.mail.api.admin.update_member',
    prefix: '/api/suite/mail/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: ['PermissionError', 'ValidationError'],
    loadValidators: async () => (await import('./validators')).operationUpdateMember,
  }

export type VerifyDomainInput = { domain_id: string }

export type VerifyDomainOutput = { is_verified: boolean }

export type VerifyDomainError = 'PermissionError' | 'ValidationError'

const operationVerifyDomain: MutationRef<VerifyDomainInput, VerifyDomainOutput, VerifyDomainError> =
  {
    id: 'verify_domain',
    owner: 'mail',
    kind: 'mutation',
    publicName: 'admin.domains.verify',
    envelope: 'message',
    method: 'POST',
    path: '/api/method/suite.mail.api.admin.verify_domain',
    prefix: '/api/suite/mail/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: ['PermissionError', 'ValidationError'],
    loadValidators: async () => (await import('./validators')).operationVerifyDomain,
  }

export type AddIdentityInputAddress = { display_name: string | null; email: string }

export type AddIdentityInput = {
  account: string
  email: string
  name?: string | null
  reply_to?: Array<AddIdentityInputAddress> | null
  bcc?: Array<AddIdentityInputAddress> | null
  text_signature?: string | null
  html_signature?: string | null
}

export type AddIdentityOutput = string

export type AddIdentityError = 'PermissionError' | 'ValidationError'

const operationAddIdentity: MutationRef<AddIdentityInput, AddIdentityOutput, AddIdentityError> = {
  id: 'add_identity',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'identities.create',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.identity.identity.add_identity',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddIdentity,
}

export type DeleteIdentityNamesInput = { names: Array<string> }

export type DeleteIdentityNamesOutput = null

export type DeleteIdentityNamesError = 'PermissionError' | 'ValidationError'

const operationDeleteIdentityNames: MutationRef<
  DeleteIdentityNamesInput,
  DeleteIdentityNamesOutput,
  DeleteIdentityNamesError
> = {
  id: 'delete_identity_names',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'identities.delete',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.identity.identity.bulk_delete',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteIdentityNames,
}

export type GetDmarcReportOutputAuthenticationResult = {
  domain?: string
  selector?: string
  scope?: string
  result?: string
}

export type GetDmarcReportOutputDmarcPolicy = {
  domain?: string
  testing_mode?: boolean
  adkim?: string | null
  aspf?: string | null
  p?: string | null
  sp?: string | null
  pct?: number
  fo?: string
}

export type GetDmarcReportOutputDmarcRecord = {
  source_ip: string | null
  count: number
  disposition: string | null
  dkim: string | null
  spf: string | null
  header_from: string | null
  envelope_from: string | null
  envelope_to: string | null
  override_reasons: string | null
  dkim_results: Array<GetDmarcReportOutputAuthenticationResult>
  spf_results: Array<GetDmarcReportOutputAuthenticationResult>
}

export type GetDmarcReportInput = { report_id: string }

export type GetDmarcReportOutput = {
  id: string
  domain: string | null
  reporter: string | null
  reporter_email: string | null
  report_id: string | null
  subject: string | null
  to: Array<string>
  date_range_begin: string | null
  date_range_end: string | null
  received_at: string | null
  reports: number
  version: number | null
  policy: GetDmarcReportOutputDmarcPolicy
  errors: string | null
  pass_rate: number | null
  messages: number
  passed: number
  failed: number
  dkim_passed: number
  spf_passed: number
  records: Array<GetDmarcReportOutputDmarcRecord>
}

export type GetDmarcReportError = 'PermissionError' | 'ValidationError'

const operationGetDmarcReport: QueryRef<
  GetDmarcReportInput,
  GetDmarcReportOutput,
  GetDmarcReportError
> = {
  id: 'get_dmarc_report',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.dmarc.get',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_dmarc_report',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetDmarcReport,
}

export type GetDmarcSummaryOutputDmarcDomain = {
  reports: number
  messages: number
  passed: number
  failed: number
  dkim_passed: number
  spf_passed: number
  pass_rate: number | null
  domain: string | null
}

export type GetDmarcSummaryOutputDmarcReporter = {
  reports: number
  messages: number
  passed: number
  failed: number
  dkim_passed: number
  spf_passed: number
  pass_rate: number | null
  reporter: string | null
}

export type GetDmarcSummaryOutputDmarcSource = {
  reports: number
  messages: number
  passed: number
  failed: number
  dkim_passed: number
  spf_passed: number
  pass_rate: number | null
  source_ip: string | null
}

export type GetDmarcSummaryOutputDmarcTotals = {
  reports: number
  messages: number
  passed: number
  failed: number
  dkim_passed: number
  spf_passed: number
  pass_rate: number | null
}

export type GetDmarcSummaryInput = { domain_id?: string | null; days?: number }

export type GetDmarcSummaryOutput = {
  since: string | null
  until: string | null
  totals: GetDmarcSummaryOutputDmarcTotals
  domains: Array<GetDmarcSummaryOutputDmarcDomain>
  sources: Array<GetDmarcSummaryOutputDmarcSource>
  reporters: Array<GetDmarcSummaryOutputDmarcReporter>
}

export type GetDmarcSummaryError = 'PermissionError' | 'ValidationError'

const operationGetDmarcSummary: QueryRef<
  GetDmarcSummaryInput,
  GetDmarcSummaryOutput,
  GetDmarcSummaryError
> = {
  id: 'get_dmarc_summary',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.dmarc.summary',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_dmarc_summary',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetDmarcSummary,
}

export type GetTlsReportOutputTlsFailure = {
  result_type: string | null
  count: number
  policy_type: string | null
  policy_domain: string | null
  sending_mta_ip: string | null
  receiving_mx_hostname: string | null
  receiving_mx_helo: string | null
  receiving_ip: string | null
  failure_reason_code: string | null
  additional_information: string | null
}

export type GetTlsReportOutputTlsPolicy = {
  policy_type: string | null
  policy_domain: string | null
  mx_hosts: Array<string>
  policy_strings: Array<string>
  successful: number
  failed: number
}

export type GetTlsReportInput = { report_id: string }

export type GetTlsReportOutput = {
  id: string
  domain: string | null
  reporter: string | null
  reporter_email: string | null
  report_id: string | null
  subject: string | null
  to: Array<string>
  date_range_begin: string | null
  date_range_end: string | null
  received_at: string | null
  reports: number
  contact_info: string | null
  policy_types: Array<string>
  successful: number
  failed: number
  sessions: number
  success_rate: number | null
  policies: Array<GetTlsReportOutputTlsPolicy>
  failures: Array<GetTlsReportOutputTlsFailure>
}

export type GetTlsReportError = 'PermissionError' | 'ValidationError'

const operationGetTlsReport: QueryRef<GetTlsReportInput, GetTlsReportOutput, GetTlsReportError> = {
  id: 'get_tls_report',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.tls.get',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_tls_report',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetTlsReport,
}

export type GetTlsSummaryOutputFailureType = {
  result_type: string | null
  reports: number
  failed: number
}

export type GetTlsSummaryOutputTlsDomain = {
  reports: number
  sessions: number
  successful: number
  failed: number
  success_rate: number | null
  domain: string | null
}

export type GetTlsSummaryOutputTlsReporter = {
  reports: number
  sessions: number
  successful: number
  failed: number
  success_rate: number | null
  reporter: string | null
}

export type GetTlsSummaryOutputTlsTotals = {
  reports: number
  sessions: number
  successful: number
  failed: number
  success_rate: number | null
}

export type GetTlsSummaryInput = { domain_id?: string | null; days?: number }

export type GetTlsSummaryOutput = {
  since: string | null
  until: string | null
  totals: GetTlsSummaryOutputTlsTotals
  domains: Array<GetTlsSummaryOutputTlsDomain>
  reporters: Array<GetTlsSummaryOutputTlsReporter>
  failures: Array<GetTlsSummaryOutputFailureType>
}

export type GetTlsSummaryError = 'PermissionError' | 'ValidationError'

const operationGetTlsSummary: QueryRef<
  GetTlsSummaryInput,
  GetTlsSummaryOutput,
  GetTlsSummaryError
> = {
  id: 'get_tls_summary',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.tls.summary',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_tls_summary',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetTlsSummary,
}

export type GetOverviewOutputAttentionDomain = {
  name: string
  status: string
  last_verified_at: string | null
}

export type GetOverviewOutputDisabledAccount = { name: string; full_name: string }

export type GetOverviewOutputInviteCount = {
  pending: number
  expiring_soon: number
  expired: number
}

export type GetOverviewOutputLimits = {
  max_domains?: number
  max_accounts?: number
  max_groups?: number
  max_mailing_lists?: number
  max_disk_gb?: number
  default_disk_quota_gb?: number
}

export type GetOverviewOutputMemberCount = { total: number; disabled: number }

export type GetOverviewOutputRecentAccount = {
  name: string
  full_name: string
  user_image: string
  enabled: boolean
  joined_on: string | null
}

export type GetOverviewOutputSite = {
  site: string | null
  title: string | null
  status: string | null
  cluster: string | null
  mail_hostname: string | null
  jmap_url: string | null
  contact_email: string | null
}

export type GetOverviewOutputStorage = {
  allocated_gb: number | null
  max_gb: number | null
  default_quota_gb: number | null
}

export type GetOverviewOutputWorkspace = { name: string | null; logo: string | null }

export type GetOverviewInput = Record<string, never>

export type GetOverviewOutput = {
  members: GetOverviewOutputMemberCount | null
  pending_invites: number | null
  domains: number | null
  groups: number | null
  mailing_lists: number | null
  limits: GetOverviewOutputLimits | null
  storage?: GetOverviewOutputStorage
  site?: GetOverviewOutputSite
  domains_needing_attention?: Array<GetOverviewOutputAttentionDomain>
  invites?: GetOverviewOutputInviteCount
  recent_accounts?: Array<GetOverviewOutputRecentAccount>
  disabled_accounts?: Array<GetOverviewOutputDisabledAccount>
  workspace?: GetOverviewOutputWorkspace
}

export type GetOverviewError = 'PermissionError'

const operationGetOverview: QueryRef<GetOverviewInput, GetOverviewOutput, GetOverviewError> = {
  id: 'get_overview',
  owner: 'mail',
  kind: 'query',
  publicName: 'admin.overview.get',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.admin.get_overview',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError'],
  loadValidators: async () => (await import('./validators')).operationGetOverview,
}

export type GetContactCardsInputContactFilter = {
  text?: string
  email?: string
  name?: string
  inAddressBook?: string
  notInAddressBook?: string
  kind?: string
  hasEmail?: boolean
  operator?: string
  conditions?: Array<GetContactCardsInputContactFilter>
}

export type GetContactCardsOutputContactSummary = {
  id: string
  full_name: string | null
  kind: string | null
  emails: Array<GetContactCardsOutputEmail>
}

export type GetContactCardsOutputEmail = {
  address: string | null
  type?: string | null
  label?: string | null
  contexts?: string | null
}

export type GetContactCardsInput = {
  account: string
  filter?: GetContactCardsInputContactFilter | null
  limit?: number
  start?: number
}

export type GetContactCardsOutput = {
  rows: Array<GetContactCardsOutputContactSummary>
  total: number
}

export type GetContactCardsError = 'PermissionError' | 'ValidationError'

const operationGetContactCards: PageRef<
  GetContactCardsInput,
  GetContactCardsOutputContactSummary,
  GetContactCardsError,
  GetContactCardsOutput
> = {
  id: 'get_contact_cards',
  owner: 'mail',
  kind: 'query',
  publicName: 'contacts.list',
  envelope: 'message',
  page: { offset: 'start', rows: 'rows', total: 'total' },
  method: 'POST',
  path: '/api/method/suite.mail.api.contacts.get_contact_cards',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetContactCards,
}

export type GetContactsInputContactFilter = {
  text?: string
  email?: string
  name?: string
  inAddressBook?: string
  notInAddressBook?: string
  kind?: string
  hasEmail?: boolean
  operator?: string
  conditions?: Array<GetContactsInputContactFilter>
}

export type GetContactsOutputRecipientContact = {
  full_name: string | null
  email: string | null
  user_image: string | null
}

export type GetContactsInput = {
  account: string
  filter?: GetContactsInputContactFilter | null
  limit?: number
  start?: number
}

export type GetContactsOutput = Array<GetContactsOutputRecipientContact>

export type GetContactsError = 'PermissionError' | 'ValidationError'

const operationGetContacts: QueryRef<GetContactsInput, GetContactsOutput, GetContactsError> = {
  id: 'get_contacts',
  owner: 'mail',
  kind: 'query',
  publicName: 'contacts.emails',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.contacts.get_contacts',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetContacts,
}

export type GetAddressBookContactCountInput = { account: string; address_book: string }

export type GetAddressBookContactCountOutput = number

export type GetAddressBookContactCountError = 'PermissionError' | 'ValidationError'

const operationGetAddressBookContactCount: QueryRef<
  GetAddressBookContactCountInput,
  GetAddressBookContactCountOutput,
  GetAddressBookContactCountError
> = {
  id: 'get_address_book_contact_count',
  owner: 'mail',
  kind: 'query',
  publicName: 'addressBooks.contactCount',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.contacts.get_address_book_contact_count',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetAddressBookContactCount,
}

export type AddContactCardInputEmail = {
  address: string | null
  type?: string | null
  label?: string | null
  contexts?: string | null
}

export type AddContactCardInputPhone = {
  number: string | null
  type?: string | null
  label?: string | null
  contexts?: string | null
}

export type AddContactCardInputPostalAddress = {
  idx?: number
  type?: string | null
  street?: string | null
  locality?: string | null
  region?: string | null
  postcode?: string | null
  country?: string | null
  time_zone?: string | null
  contexts?: string | null
}

export type AddContactCardInput = {
  account: string
  address_book_ids: Array<string>
  full_name?: string | null
  kind?: string | null
  emails?: Array<AddContactCardInputEmail> | null
  phones?: Array<AddContactCardInputPhone> | null
  addresses?: Array<AddContactCardInputPostalAddress> | null
}

export type AddContactCardOutput = string

export type AddContactCardError = 'PermissionError' | 'ValidationError'

const operationAddContactCard: MutationRef<
  AddContactCardInput,
  AddContactCardOutput,
  AddContactCardError
> = {
  id: 'add_contact_card',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'contacts.create',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.contact_card.contact_card.add_contact_card',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddContactCard,
}

export type DeleteContactCardsInput = { account: string; ids: Array<string> }

export type DeleteContactCardsOutput = null

export type DeleteContactCardsError = 'PermissionError' | 'ValidationError'

const operationDeleteContactCards: MutationRef<
  DeleteContactCardsInput,
  DeleteContactCardsOutput,
  DeleteContactCardsError
> = {
  id: 'delete_contact_cards',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'contacts.delete',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.contact_card.contact_card.delete_contact_cards',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteContactCards,
}

export type ContactCardAddToAddressBookInput = {
  account: string
  ids: Array<string>
  address_book_id: string
}

export type ContactCardAddToAddressBookOutput = null

export type ContactCardAddToAddressBookError = 'PermissionError' | 'ValidationError'

const operationContactCardAddToAddressBook: MutationRef<
  ContactCardAddToAddressBookInput,
  ContactCardAddToAddressBookOutput,
  ContactCardAddToAddressBookError
> = {
  id: 'contact_card_add_to_address_book',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'contacts.addToBook',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.contact_card.contact_card.contact_card_add_to_address_book',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationContactCardAddToAddressBook,
}

export type ContactCardRemoveFromAddressBookInput = {
  account: string
  ids: Array<string>
  address_book_id: string
}

export type ContactCardRemoveFromAddressBookOutput = null

export type ContactCardRemoveFromAddressBookError = 'PermissionError' | 'ValidationError'

const operationContactCardRemoveFromAddressBook: MutationRef<
  ContactCardRemoveFromAddressBookInput,
  ContactCardRemoveFromAddressBookOutput,
  ContactCardRemoveFromAddressBookError
> = {
  id: 'contact_card_remove_from_address_book',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'contacts.removeFromBook',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.contact_card.contact_card.contact_card_remove_from_address_book',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () =>
    (await import('./validators')).operationContactCardRemoveFromAddressBook,
}

export type AddAddressBookInput = {
  account: string
  name: string
  description?: string | null
  sort_order?: number
  default?: boolean
  subscribed?: boolean
}

export type AddAddressBookOutput = string

export type AddAddressBookError = 'PermissionError' | 'ValidationError'

const operationAddAddressBook: MutationRef<
  AddAddressBookInput,
  AddAddressBookOutput,
  AddAddressBookError
> = {
  id: 'add_address_book',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'addressBooks.create',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.address_book.address_book.add_address_book',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddAddressBook,
}

export type DeleteAddressBooksInput = { account: string; ids: Array<string> }

export type DeleteAddressBooksOutput = null

export type DeleteAddressBooksError = 'PermissionError' | 'ValidationError'

const operationDeleteAddressBooks: MutationRef<
  DeleteAddressBooksInput,
  DeleteAddressBooksOutput,
  DeleteAddressBooksError
> = {
  id: 'delete_address_books',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'addressBooks.delete',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.address_book.address_book.delete_address_books',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteAddressBooks,
}

export type GetThreadsOutputAttachment = {
  filename: string | null
  type: string
  size: number
  blob_id: string
  disposition: string | null
  cid: string
  url: string | null
  part_id?: string | null
  charset?: string | null
  language?: string | null
  location?: string | null
}

export type GetThreadsOutputCopy = {
  name: string
  id: string
  thread_id: string
  from_name: string | null
  from_email: string
  received_at: string
  mailboxes: Array<GetThreadsOutputMailboxRef>
  seen: 0 | 1
  junk: 0 | 1
  flagged: 0 | 1
  draft: 0 | 1
  unscreened?: 0 | 1
}

export type GetThreadsOutputMailboxRef = {
  mailbox: string
  mailbox_id: string
  mailbox_name: string | null
}

export type GetThreadsOutputMessage = {
  name: string
  id: string
  thread_id: string
  from_name: string | null
  from_email: string
  received_at: string
  mailboxes: Array<GetThreadsOutputMailboxRef>
  seen: 0 | 1
  junk: 0 | 1
  flagged: 0 | 1
  draft: 0 | 1
  unscreened?: 0 | 1
  message_id: string | null
  subject: string | null
  html_body: string | null
  text_body: string | null
  preview: string
  recipients: Array<GetThreadsOutputRecipient>
  reply_to: Array<GetThreadsOutputReplyAddress>
  attachments: Array<GetThreadsOutputAttachment>
  dsn_blob_id: string | null
  duplicates?: Array<GetThreadsOutputCopy>
  user_image?: string | null
}

export type GetThreadsOutputRecipient = {
  type: 'To' | 'Cc' | 'Bcc'
  email: string
  display_name: string | null
}

export type GetThreadsOutputReplyAddress = { email: string; display_name: string | null }

export type GetThreadsOutputThread = {
  name: string
  id: string
  thread_id: string
  from_name: string | null
  from_email: string
  received_at: string
  mailboxes: Array<GetThreadsOutputMailboxRef>
  seen: 0 | 1
  junk: 0 | 1
  flagged: 0 | 1
  draft: 0 | 1
  unscreened?: 0 | 1
  account?: string
  account_name?: string
  view_mailbox?: string
  inbox?: string | null
  archive?: string | null
  trash?: string | null
  unscreened_senders?: Array<string>
  subject: string | null
  preview: string
  recipients: Array<GetThreadsOutputRecipient>
  attachments: Array<GetThreadsOutputAttachment>
  messages: Array<GetThreadsOutputMessage>
  user_image?: string | null
}

export type GetThreadsInput = {
  account: string
  limit: number
  start?: number
  filter_by?: string | null
  mailbox: string
}

export type GetThreadsOutput = {
  rows: Array<GetThreadsOutputThread>
  mailbox: string
  has_more: boolean
}

export type GetThreadsError = 'PermissionError' | 'ValidationError'

const operationGetThreads: PageRef<
  GetThreadsInput,
  GetThreadsOutputThread,
  GetThreadsError,
  GetThreadsOutput
> = {
  id: 'get_threads',
  owner: 'mail',
  kind: 'query',
  publicName: 'threads.list',
  envelope: 'message',
  page: { offset: 'start', rows: 'rows', more: 'has_more' },
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.get_threads',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetThreads,
}

export type GetUnifiedThreadsOutputAttachment = {
  filename: string | null
  type: string
  size: number
  blob_id: string
  disposition: string | null
  cid: string
  url: string | null
  part_id?: string | null
  charset?: string | null
  language?: string | null
  location?: string | null
}

export type GetUnifiedThreadsOutputCopy = {
  name: string
  id: string
  thread_id: string
  from_name: string | null
  from_email: string
  received_at: string
  mailboxes: Array<GetUnifiedThreadsOutputMailboxRef>
  seen: 0 | 1
  junk: 0 | 1
  flagged: 0 | 1
  draft: 0 | 1
  unscreened?: 0 | 1
}

export type GetUnifiedThreadsOutputMailboxRef = {
  mailbox: string
  mailbox_id: string
  mailbox_name: string | null
}

export type GetUnifiedThreadsOutputMessage = {
  name: string
  id: string
  thread_id: string
  from_name: string | null
  from_email: string
  received_at: string
  mailboxes: Array<GetUnifiedThreadsOutputMailboxRef>
  seen: 0 | 1
  junk: 0 | 1
  flagged: 0 | 1
  draft: 0 | 1
  unscreened?: 0 | 1
  message_id: string | null
  subject: string | null
  html_body: string | null
  text_body: string | null
  preview: string
  recipients: Array<GetUnifiedThreadsOutputRecipient>
  reply_to: Array<GetUnifiedThreadsOutputReplyAddress>
  attachments: Array<GetUnifiedThreadsOutputAttachment>
  dsn_blob_id: string | null
  duplicates?: Array<GetUnifiedThreadsOutputCopy>
  user_image?: string | null
}

export type GetUnifiedThreadsOutputRecipient = {
  type: 'To' | 'Cc' | 'Bcc'
  email: string
  display_name: string | null
}

export type GetUnifiedThreadsOutputReplyAddress = { email: string; display_name: string | null }

export type GetUnifiedThreadsOutputThread = {
  name: string
  id: string
  thread_id: string
  from_name: string | null
  from_email: string
  received_at: string
  mailboxes: Array<GetUnifiedThreadsOutputMailboxRef>
  seen: 0 | 1
  junk: 0 | 1
  flagged: 0 | 1
  draft: 0 | 1
  unscreened?: 0 | 1
  account?: string
  account_name?: string
  view_mailbox?: string
  inbox?: string | null
  archive?: string | null
  trash?: string | null
  unscreened_senders?: Array<string>
  subject: string | null
  preview: string
  recipients: Array<GetUnifiedThreadsOutputRecipient>
  attachments: Array<GetUnifiedThreadsOutputAttachment>
  messages: Array<GetUnifiedThreadsOutputMessage>
  user_image?: string | null
}

export type GetUnifiedThreadsInput = {
  limit: number
  start?: number
  filter_by?: string | null
  folder: string
}

export type GetUnifiedThreadsOutput = {
  rows: Array<GetUnifiedThreadsOutputThread>
  has_more: boolean
}

export type GetUnifiedThreadsError = 'PermissionError' | 'ValidationError'

const operationGetUnifiedThreads: PageRef<
  GetUnifiedThreadsInput,
  GetUnifiedThreadsOutputThread,
  GetUnifiedThreadsError,
  GetUnifiedThreadsOutput
> = {
  id: 'get_unified_threads',
  owner: 'mail',
  kind: 'query',
  publicName: 'unified.threads',
  envelope: 'message',
  page: { offset: 'start', rows: 'rows', more: 'has_more' },
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.get_unified_threads',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetUnifiedThreads,
}

export type GetThreadOutputAttachment = {
  filename: string | null
  type: string
  size: number
  blob_id: string
  disposition: string | null
  cid: string
  url: string | null
  part_id?: string | null
  charset?: string | null
  language?: string | null
  location?: string | null
}

export type GetThreadOutputCopy = {
  name: string
  id: string
  thread_id: string
  from_name: string | null
  from_email: string
  received_at: string
  mailboxes: Array<GetThreadOutputMailboxRef>
  seen: 0 | 1
  junk: 0 | 1
  flagged: 0 | 1
  draft: 0 | 1
  unscreened?: 0 | 1
}

export type GetThreadOutputMailboxRef = {
  mailbox: string
  mailbox_id: string
  mailbox_name: string | null
}

export type GetThreadOutputMessage = {
  name: string
  id: string
  thread_id: string
  from_name: string | null
  from_email: string
  received_at: string
  mailboxes: Array<GetThreadOutputMailboxRef>
  seen: 0 | 1
  junk: 0 | 1
  flagged: 0 | 1
  draft: 0 | 1
  unscreened?: 0 | 1
  message_id: string | null
  subject: string | null
  html_body: string | null
  text_body: string | null
  preview: string
  recipients: Array<GetThreadOutputRecipient>
  reply_to: Array<GetThreadOutputReplyAddress>
  attachments: Array<GetThreadOutputAttachment>
  dsn_blob_id: string | null
  duplicates?: Array<GetThreadOutputCopy>
  user_image?: string | null
}

export type GetThreadOutputRecipient = {
  type: 'To' | 'Cc' | 'Bcc'
  email: string
  display_name: string | null
}

export type GetThreadOutputReplyAddress = { email: string; display_name: string | null }

export type GetThreadInput = { account: string; thread_id: string }

export type GetThreadOutput = Array<GetThreadOutputMessage>

export type GetThreadError = 'PermissionError' | 'ValidationError'

const operationGetThread: QueryRef<GetThreadInput, GetThreadOutput, GetThreadError> = {
  id: 'get_thread',
  owner: 'mail',
  kind: 'query',
  publicName: 'threads.get',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.get_thread',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetThread,
}

export type SearchMailsInputSearchFilter = {
  text?: string
  from?: string
  to?: string
  cc?: string
  bcc?: string
  subject?: string
  body?: string
  before?: string
  after?: string
  inMailbox?: string
  inMailboxOtherThan?: Array<string>
  hasAttachment?: boolean | string
  isRead?: boolean | string
  hasKeyword?: string
  notKeyword?: string
  someInThreadHaveKeyword?: string
  minSize?: number
  maxSize?: number
  operator?: string
  conditions?: Array<SearchMailsInputSearchFilter>
  all_accounts?: string | boolean
}

export type SearchMailsOutputAttachment = {
  filename: string | null
  type: string
  size: number
  blob_id: string
  disposition: string | null
  cid: string
  url: string | null
  part_id?: string | null
  charset?: string | null
  language?: string | null
  location?: string | null
}

export type SearchMailsOutputMailboxRef = {
  mailbox: string
  mailbox_id: string
  mailbox_name: string | null
}

export type SearchMailsOutputRecipient = {
  type: 'To' | 'Cc' | 'Bcc'
  email: string
  display_name: string | null
}

export type SearchMailsOutputSearchRow = {
  account?: string
  account_name?: string
  view_mailbox?: string
  inbox?: string | null
  archive?: string | null
  trash?: string | null
  name: string
  id: string
  subject: string | null
  preview: string
  recipients: Array<SearchMailsOutputRecipient>
  sent_at: string | null
  received_at: string
  from_name: string | null
  from_email: string
  thread_id: string
  mailboxes: Array<SearchMailsOutputMailboxRef>
  attachments: Array<SearchMailsOutputAttachment>
  seen: 0 | 1
  user_image?: string | null
}

export type SearchMailsInput = {
  account: string
  filter?: SearchMailsInputSearchFilter | null
  limit?: number
  start?: number
  all_accounts?: boolean
}

export type SearchMailsOutput = { rows: Array<SearchMailsOutputSearchRow>; total: number }

export type SearchMailsError = 'PermissionError' | 'ValidationError'

const operationSearchMails: PageRef<
  SearchMailsInput,
  SearchMailsOutputSearchRow,
  SearchMailsError,
  SearchMailsOutput
> = {
  id: 'search_mails',
  owner: 'mail',
  kind: 'query',
  publicName: 'messages.search',
  envelope: 'message',
  page: { offset: 'start', rows: 'rows', total: 'total' },
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.search_mails',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSearchMails,
}

export type GetMimeMessageOutputMimeField = {
  label: string
  value: string | null
  description?: string
}

export type GetMimeMessageInput = { name: string }

export type GetMimeMessageOutput = {
  message: string
  message_id: GetMimeMessageOutputMimeField
  created_at: GetMimeMessageOutputMimeField
  subject: GetMimeMessageOutputMimeField
  from: GetMimeMessageOutputMimeField
  to: GetMimeMessageOutputMimeField
  cc: GetMimeMessageOutputMimeField
  bcc: GetMimeMessageOutputMimeField
  spf?: GetMimeMessageOutputMimeField
  dkim?: GetMimeMessageOutputMimeField
  dmarc?: GetMimeMessageOutputMimeField
}

export type GetMimeMessageError = 'PermissionError' | 'ValidationError'

const operationGetMimeMessage: QueryRef<
  GetMimeMessageInput,
  GetMimeMessageOutput,
  GetMimeMessageError
> = {
  id: 'get_mime_message',
  owner: 'mail',
  kind: 'query',
  publicName: 'messages.mime',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.get_mime_message',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetMimeMessage,
}

export type GetDeliveryStatusOutputDeliveryRecipient = {
  email: string
  action: string
  status: string
  diagnostic_code: string
  remote_mta: string
  will_retry_until: string
}

export type GetDeliveryStatusInput = { account: string; blob_id: string }

export type GetDeliveryStatusOutput = {
  reporting_mta: string
  arrival_date: string
  recipients: Array<GetDeliveryStatusOutputDeliveryRecipient>
}

export type GetDeliveryStatusError = 'PermissionError' | 'ValidationError'

const operationGetDeliveryStatus: QueryRef<
  GetDeliveryStatusInput,
  GetDeliveryStatusOutput,
  GetDeliveryStatusError
> = {
  id: 'get_delivery_status',
  owner: 'mail',
  kind: 'query',
  publicName: 'messages.deliveryStatus',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.get_delivery_status',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetDeliveryStatus,
}

export type CreateMailInputDraftAttachment = {
  filename?: string
  file_url?: string
  blob_id?: string
  type?: string
  size?: number | string
  disposition?: string | null
  cid?: string
}

export type CreateMailInputRecipientInput = { email: string; display_name?: string | null }

export type CreateMailInput = {
  account: string
  from_email: string
  to: Array<CreateMailInputRecipientInput>
  cc: Array<CreateMailInputRecipientInput>
  bcc: Array<CreateMailInputRecipientInput>
  subject: string | null
  html_body: string | null
  from_name?: string
  attachments?: Array<CreateMailInputDraftAttachment> | null
  send_at?: string | null
  undo_send?: boolean
  in_reply_to?: string | null
  in_reply_to_id?: string | null
  forwarded_from_id?: string | null
  save_as_draft?: boolean
}

export type CreateMailOutput = {
  name: string
  id: string | null
  status: string
  error: string | null
  thread_id: string | null
  submission_id: string | null
  send_at: string | null
  undo_send_period: number | null
}

export type CreateMailError = 'PermissionError' | 'ValidationError'

const operationCreateMail: MutationRef<CreateMailInput, CreateMailOutput, CreateMailError> = {
  id: 'create_mail',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'messages.create',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.create_mail',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationCreateMail,
}

export type UpdateDraftMailInputDraftAttachment = {
  filename?: string
  file_url?: string
  blob_id?: string
  type?: string
  size?: number | string
  disposition?: string | null
  cid?: string
}

export type UpdateDraftMailInputRecipientInput = { email: string; display_name?: string | null }

export type UpdateDraftMailInput = {
  account: string
  from_email: string
  to: Array<UpdateDraftMailInputRecipientInput>
  cc: Array<UpdateDraftMailInputRecipientInput>
  bcc: Array<UpdateDraftMailInputRecipientInput>
  subject: string | null
  html_body: string | null
  from_name?: string
  attachments?: Array<UpdateDraftMailInputDraftAttachment> | null
  send_at?: string | null
  undo_send?: boolean
  id: string
  submit?: boolean
}

export type UpdateDraftMailOutput = {
  name: string
  id: string | null
  status: string
  error: string | null
  thread_id: string | null
  submission_id: string | null
  send_at: string | null
  undo_send_period: number | null
}

export type UpdateDraftMailError = 'PermissionError' | 'ValidationError'

const operationUpdateDraftMail: MutationRef<
  UpdateDraftMailInput,
  UpdateDraftMailOutput,
  UpdateDraftMailError
> = {
  id: 'update_draft_mail',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'messages.updateDraft',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.update_draft_mail',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationUpdateDraftMail,
}

export type DeleteMailInput = { account: string; id: string }

export type DeleteMailOutput = null

export type DeleteMailError = 'PermissionError' | 'ValidationError'

const operationDeleteMail: MutationRef<DeleteMailInput, DeleteMailOutput, DeleteMailError> = {
  id: 'delete_mail',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'messages.deleteDraft',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.delete_mail',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeleteMail,
}

export type SetFlaggedInput = { account: string; ids: Array<string>; flagged: boolean }

export type SetFlaggedOutput = { ids: Array<string>; flagged: boolean }

export type SetFlaggedError = 'PermissionError' | 'ValidationError'

const operationSetFlagged: MutationRef<SetFlaggedInput, SetFlaggedOutput, SetFlaggedError> = {
  id: 'set_flagged',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'messages.flag',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.set_flagged',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSetFlagged,
}

export type SetMailsSeenInput = { account: string; ids: Array<string>; seen: boolean }

export type SetMailsSeenOutput = Array<string>

export type SetMailsSeenError = 'PermissionError' | 'ValidationError'

const operationSetMailsSeen: MutationRef<SetMailsSeenInput, SetMailsSeenOutput, SetMailsSeenError> =
  {
    id: 'set_mails_seen',
    owner: 'mail',
    kind: 'mutation',
    publicName: 'messages.seen',
    envelope: 'message',
    method: 'POST',
    path: '/api/method/suite.mail.api.mail.set_mails_seen',
    prefix: '/api/suite/mail/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: ['PermissionError', 'ValidationError'],
    loadValidators: async () => (await import('./validators')).operationSetMailsSeen,
  }

export type MoveMailsInput = {
  account: string
  ids: Array<string>
  mailbox: string
  clear_junk?: boolean
}

export type MoveMailsOutput = null

export type MoveMailsError = 'PermissionError' | 'ValidationError'

const operationMoveMails: MutationRef<MoveMailsInput, MoveMailsOutput, MoveMailsError> = {
  id: 'move_mails',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'messages.move',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.move_mails',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationMoveMails,
}

export type AddMailsToMailboxInput = { account: string; ids: Array<string>; mailbox_id: string }

export type AddMailsToMailboxOutput = null

export type AddMailsToMailboxError = 'PermissionError' | 'ValidationError'

const operationAddMailsToMailbox: MutationRef<
  AddMailsToMailboxInput,
  AddMailsToMailboxOutput,
  AddMailsToMailboxError
> = {
  id: 'add_mails_to_mailbox',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'messages.addToFolder',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.add_mails_to_mailbox',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddMailsToMailbox,
}

export type RemoveMailsFromMailboxInput = {
  account: string
  ids: Array<string>
  mailbox_id: string
}

export type RemoveMailsFromMailboxOutput = null

export type RemoveMailsFromMailboxError = 'PermissionError' | 'ValidationError'

const operationRemoveMailsFromMailbox: MutationRef<
  RemoveMailsFromMailboxInput,
  RemoveMailsFromMailboxOutput,
  RemoveMailsFromMailboxError
> = {
  id: 'remove_mails_from_mailbox',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'messages.removeFromFolder',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.remove_mails_from_mailbox',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationRemoveMailsFromMailbox,
}

export type SetMailsMailboxesInputMembership = {
  id: string
  mailbox_ids: Array<string>
  junk: number
}

export type SetMailsMailboxesInput = {
  account: string
  mails: Array<SetMailsMailboxesInputMembership>
  screen_action?: string | null
}

export type SetMailsMailboxesOutput = null

export type SetMailsMailboxesError = 'PermissionError' | 'ValidationError'

const operationSetMailsMailboxes: MutationRef<
  SetMailsMailboxesInput,
  SetMailsMailboxesOutput,
  SetMailsMailboxesError
> = {
  id: 'set_mails_mailboxes',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'messages.setFolders',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.set_mails_mailboxes',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSetMailsMailboxes,
}

export type SetMailsSpamStatusInput = {
  account: string
  ids: Array<string>
  spam: boolean
  screen_action?: string | null
}

export type SetMailsSpamStatusOutput = Array<string>

export type SetMailsSpamStatusError = 'PermissionError' | 'ValidationError'

const operationSetMailsSpamStatus: MutationRef<
  SetMailsSpamStatusInput,
  SetMailsSpamStatusOutput,
  SetMailsSpamStatusError
> = {
  id: 'set_mails_spam_status',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'messages.spam',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.set_mails_spam_status',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSetMailsSpamStatus,
}

export type EmptyUserMailboxInput = { account: string; mailbox: string }

export type EmptyUserMailboxOutput = null

export type EmptyUserMailboxError = 'PermissionError' | 'ValidationError'

const operationEmptyUserMailbox: MutationRef<
  EmptyUserMailboxInput,
  EmptyUserMailboxOutput,
  EmptyUserMailboxError
> = {
  id: 'empty_user_mailbox',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'mailboxes.empty',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.empty_user_mailbox',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationEmptyUserMailbox,
}

export type AllowScreeningSendersInput = {
  account: string
  from_emails: Array<string>
  destination?: 'inbox' | 'archive' | 'trash'
}

export type AllowScreeningSendersOutput = { [key: string]: Array<string> }

export type AllowScreeningSendersError = 'PermissionError' | 'ValidationError'

const operationAllowScreeningSenders: MutationRef<
  AllowScreeningSendersInput,
  AllowScreeningSendersOutput,
  AllowScreeningSendersError
> = {
  id: 'allow_screening_senders',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'screener.allow',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.allow_screening_senders',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAllowScreeningSenders,
}

export type ScreenOutSendersInput = { account: string; from_emails: Array<string> }

export type ScreenOutSendersOutput = { [key: string]: Array<string> }

export type ScreenOutSendersError = 'PermissionError' | 'ValidationError'

const operationScreenOutSenders: MutationRef<
  ScreenOutSendersInput,
  ScreenOutSendersOutput,
  ScreenOutSendersError
> = {
  id: 'screen_out_senders',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'screener.reject',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.screen_out_senders',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationScreenOutSenders,
}

export type UndoScreeningVerdictInput = {
  account: string
  from_emails: Array<string>
  ids: Array<string>
}

export type UndoScreeningVerdictOutput = null

export type UndoScreeningVerdictError = 'PermissionError' | 'ValidationError'

const operationUndoScreeningVerdict: MutationRef<
  UndoScreeningVerdictInput,
  UndoScreeningVerdictOutput,
  UndoScreeningVerdictError
> = {
  id: 'undo_screening_verdict',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'screener.undo',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.undo_screening_verdict',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationUndoScreeningVerdict,
}

export type BlockSendersInput = { account: string; from_emails: Array<string>; ids?: Array<string> }

export type BlockSendersOutput = { inbox: number }

export type BlockSendersError = 'PermissionError' | 'ValidationError'

const operationBlockSenders: MutationRef<BlockSendersInput, BlockSendersOutput, BlockSendersError> =
  {
    id: 'block_senders',
    owner: 'mail',
    kind: 'mutation',
    publicName: 'screening.block',
    envelope: 'message',
    method: 'POST',
    path: '/api/method/suite.mail.api.mail.block_senders',
    prefix: '/api/suite/mail/',
    pathParams: [],
    nodeParams: [],
    entity: null,
    errors: ['PermissionError', 'ValidationError'],
    loadValidators: async () => (await import('./validators')).operationBlockSenders,
  }

export type JunkSendersInboxMailInput = { account: string; from_emails: Array<string> }

export type JunkSendersInboxMailOutput = Array<string>

export type JunkSendersInboxMailError = 'PermissionError' | 'ValidationError'

const operationJunkSendersInboxMail: MutationRef<
  JunkSendersInboxMailInput,
  JunkSendersInboxMailOutput,
  JunkSendersInboxMailError
> = {
  id: 'junk_senders_inbox_mail',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'screening.junkInbox',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.junk_senders_inbox_mail',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationJunkSendersInboxMail,
}

export type GetSubmissionsOutputDeliveryError = { email: string | null; reason: string }

export type GetSubmissionsOutputRecipient = {
  type: 'To' | 'Cc' | 'Bcc'
  email: string
  display_name: string | null
}

export type GetSubmissionsOutputRecipientState = {
  email: string | null
  status:
    | 'failed'
    | 'retrying'
    | 'queued'
    | 'scheduled'
    | 'cancelled'
    | 'sent'
    | 'delivered'
    | 'displayed'
  reason: string | null
  smtp_reply: string | null
  delivered: string | null
  displayed: string | null
  retries: number | null
  next_retry: string | null
}

export type GetSubmissionsOutputSubmission = {
  id: string
  email_id: string | null
  thread_id: string | null
  send_at: string | null
  undo_status: ('pending' | 'final' | 'canceled') | null
  status:
    | 'failed'
    | 'retrying'
    | 'queued'
    | 'scheduled'
    | 'cancelled'
    | 'sent'
    | 'delivered'
    | 'displayed'
  retries: number | null
  recipients_status: Array<GetSubmissionsOutputRecipientState>
  delivery_errors: Array<GetSubmissionsOutputDeliveryError>
  subject: string | null
  from_name: string | null
  from_email: string | null
  recipients: Array<GetSubmissionsOutputRecipient>
  email_deleted: boolean
}

export type GetSubmissionsInput = {
  account: string
  undo_status?: string | null
  identity_id?: string | null
  email_id?: string | null
  thread_id?: string | null
  before?: string | null
  after?: string | null
  start?: number
  page_length?: number
}

export type GetSubmissionsOutput = { rows: Array<GetSubmissionsOutputSubmission>; total: number }

export type GetSubmissionsError = 'PermissionError' | 'ValidationError'

const operationGetSubmissions: PageRef<
  GetSubmissionsInput,
  GetSubmissionsOutputSubmission,
  GetSubmissionsError,
  GetSubmissionsOutput
> = {
  id: 'get_submissions',
  owner: 'mail',
  kind: 'query',
  publicName: 'scheduled.list',
  envelope: 'message',
  page: { offset: 'start', rows: 'rows', total: 'total' },
  method: 'POST',
  path: '/api/method/suite.mail.api.scheduled.get_submissions',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetSubmissions,
}

export type GetScheduledMailOutputDeliveryError = { email: string | null; reason: string }

export type GetScheduledMailOutputRecipient = {
  type: 'To' | 'Cc' | 'Bcc'
  email: string
  display_name: string | null
}

export type GetScheduledMailOutputRecipientState = {
  email: string | null
  status:
    | 'failed'
    | 'retrying'
    | 'queued'
    | 'scheduled'
    | 'cancelled'
    | 'sent'
    | 'delivered'
    | 'displayed'
  reason: string | null
  smtp_reply: string | null
  delivered: string | null
  displayed: string | null
  retries: number | null
  next_retry: string | null
}

export type GetScheduledMailInput = { account: string; id: string }

export type GetScheduledMailOutput = {
  id: string
  email_id: string | null
  thread_id: string | null
  send_at: string | null
  undo_status: ('pending' | 'final' | 'canceled') | null
  status:
    | 'failed'
    | 'retrying'
    | 'queued'
    | 'scheduled'
    | 'cancelled'
    | 'sent'
    | 'delivered'
    | 'displayed'
  retries: number | null
  recipients_status: Array<GetScheduledMailOutputRecipientState>
  delivery_errors: Array<GetScheduledMailOutputDeliveryError>
  subject: string | null
  from_name: string | null
  from_email: string | null
  recipients: Array<GetScheduledMailOutputRecipient>
  email_deleted: boolean
  identity_email: string | null
  envelope_from: string | null
  envelope_recipients: Array<string | null>
  priority: number
  next_retry: string | null
  dsn_count: number
  mdn_count: number
}

export type GetScheduledMailError = 'PermissionError' | 'ValidationError'

const operationGetScheduledMail: QueryRef<
  GetScheduledMailInput,
  GetScheduledMailOutput,
  GetScheduledMailError
> = {
  id: 'get_scheduled_mail',
  owner: 'mail',
  kind: 'query',
  publicName: 'scheduled.get',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.scheduled.get_scheduled_mail',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationGetScheduledMail,
}

export type RescheduleMailInput = { account: string; id: string; send_at: string }

export type RescheduleMailOutput = { id: string | null; send_at: string }

export type RescheduleMailError = 'PermissionError' | 'ValidationError'

const operationRescheduleMail: MutationRef<
  RescheduleMailInput,
  RescheduleMailOutput,
  RescheduleMailError
> = {
  id: 'reschedule_mail',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'scheduled.reschedule',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.scheduled.reschedule_mail',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationRescheduleMail,
}

export type SendScheduledMailNowInput = { account: string; id: string }

export type SendScheduledMailNowOutput = { id: string | null; thread_id: string | null }

export type SendScheduledMailNowError = 'PermissionError' | 'ValidationError'

const operationSendScheduledMailNow: MutationRef<
  SendScheduledMailNowInput,
  SendScheduledMailNowOutput,
  SendScheduledMailNowError
> = {
  id: 'send_scheduled_mail_now',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'scheduled.sendNow',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.scheduled.send_scheduled_mail_now',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationSendScheduledMailNow,
}

export type CancelScheduledMailInput = { account: string; id: string }

export type CancelScheduledMailOutput = { id: string | null }

export type CancelScheduledMailError = 'PermissionError' | 'ValidationError'

const operationCancelScheduledMail: MutationRef<
  CancelScheduledMailInput,
  CancelScheduledMailOutput,
  CancelScheduledMailError
> = {
  id: 'cancel_scheduled_mail',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'scheduled.cancel',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.scheduled.cancel_scheduled_mail',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationCancelScheduledMail,
}

export type RetryFailedMailInput = { account: string; id: string }

export type RetryFailedMailOutput = { id: string | null }

export type RetryFailedMailError = 'PermissionError' | 'ValidationError'

const operationRetryFailedMail: MutationRef<
  RetryFailedMailInput,
  RetryFailedMailOutput,
  RetryFailedMailError
> = {
  id: 'retry_failed_mail',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'scheduled.retry',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.scheduled.retry_failed_mail',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationRetryFailedMail,
}

export type DismissFailedMailInput = { account: string; id: string }

export type DismissFailedMailOutput = null

export type DismissFailedMailError = 'PermissionError' | 'ValidationError'

const operationDismissFailedMail: MutationRef<
  DismissFailedMailInput,
  DismissFailedMailOutput,
  DismissFailedMailError
> = {
  id: 'dismiss_failed_mail',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'scheduled.dismiss',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.api.scheduled.dismiss_failed_mail',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDismissFailedMail,
}

export type DeleteMessagesInput = { names: Array<string> }

export type DeleteMessagesOutput = null

export type DeleteMessagesError = never

const operationDeleteMessages: MutationRef<
  DeleteMessagesInput,
  DeleteMessagesOutput,
  DeleteMessagesError
> = {
  id: 'delete_messages',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'messages.delete',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.mail_message.mail_message.bulk_delete',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationDeleteMessages,
}

export type FetchMailAsEmlInput = { name: string }

export type FetchMailAsEmlOutput = Blob

export type FetchMailAsEmlError = never

const operationFetchMailAsEml: QueryRef<
  FetchMailAsEmlInput,
  FetchMailAsEmlOutput,
  FetchMailAsEmlError
> = {
  id: 'fetch_mail_as_eml',
  owner: 'mail',
  kind: 'query',
  publicName: 'messages.download',
  bytes: true,
  method: 'POST',
  path: '/api/method/suite.mail.api.mail.fetch_mail_as_eml',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationFetchMailAsEml,
}

export type FetchPushSubscriptionsOutputSubscription = {
  user: string
  id: string
  name: string
  device_client_id: string
  expires: string | null
  types: string
  creation: string
  modified: string
}

export type FetchPushSubscriptionsInput = { user: string; page?: number; limit?: number }

export type FetchPushSubscriptionsOutput = Array<FetchPushSubscriptionsOutputSubscription>

export type FetchPushSubscriptionsError = 'PermissionError' | 'ValidationError'

const operationFetchPushSubscriptions: QueryRef<
  FetchPushSubscriptionsInput,
  FetchPushSubscriptionsOutput,
  FetchPushSubscriptionsError
> = {
  id: 'fetch_push_subscriptions',
  owner: 'mail',
  kind: 'query',
  publicName: 'push.list',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.push_subscription.push_subscription.fetch_push_subscriptions',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationFetchPushSubscriptions,
}

export type AddPushSubscriptionInput = {
  user: string
  device_client_id?: string | null
  url?: string | null
  types?: Array<string> | null
}

export type AddPushSubscriptionOutput = string

export type AddPushSubscriptionError = 'PermissionError' | 'ValidationError'

const operationAddPushSubscription: MutationRef<
  AddPushSubscriptionInput,
  AddPushSubscriptionOutput,
  AddPushSubscriptionError
> = {
  id: 'add_push_subscription',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'push.create',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.push_subscription.push_subscription.add_push_subscription',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationAddPushSubscription,
}

export type RenewPushSubscriptionInput = { user: string; id: string }

export type RenewPushSubscriptionOutput = null

export type RenewPushSubscriptionError = 'PermissionError' | 'ValidationError'

const operationRenewPushSubscription: MutationRef<
  RenewPushSubscriptionInput,
  RenewPushSubscriptionOutput,
  RenewPushSubscriptionError
> = {
  id: 'renew_push_subscription',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'push.renew',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.push_subscription.push_subscription.renew_push_subscription',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationRenewPushSubscription,
}

export type DeletePushSubscriptionsInput = { names: Array<string> }

export type DeletePushSubscriptionsOutput = null

export type DeletePushSubscriptionsError = 'PermissionError' | 'ValidationError'

const operationDeletePushSubscriptions: MutationRef<
  DeletePushSubscriptionsInput,
  DeletePushSubscriptionsOutput,
  DeletePushSubscriptionsError
> = {
  id: 'delete_push_subscriptions',
  owner: 'mail',
  kind: 'mutation',
  publicName: 'push.delete',
  empty: true,
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.mail.doctype.push_subscription.push_subscription.bulk_delete',
  prefix: '/api/suite/mail/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: ['PermissionError', 'ValidationError'],
  loadValidators: async () => (await import('./validators')).operationDeletePushSubscriptions,
}

export const api = {
  inbox: {
    summary: operationInboxSummary,
    unreadCount: operationGetAllInboxUnreadCount,
  },
  exchanges: {
    get: operationExchange,
    attachment: operationExchangeAttachment,
    list: operationExchangeList,
    importMail: operationCreateMailImport,
    exportMail: operationCreateMailExport,
    importContacts: operationCreateContactsImport,
    exportContacts: operationCreateContactsExport,
    ongoing: operationOngoingExchange,
  },
  settings: {
    credentials: operationCredentials,
    updateCredentials: operationUpdateCredentials,
    updatePreferences: operationUpdatePreferences,
    account: operationAccountPreferences,
    updateAccount: operationUpdateAccountPreferences,
    clientConfig: operationGetMailClientConfig,
    quota: operationGetQuota,
  },
  mailboxes: {
    subscribe: operationSubscribeMailbox,
    list: operationGetMailboxes,
    create: operationCreateMailbox,
    update: operationUpdateMailbox,
    delete: operationDeleteMailbox,
    empty: operationEmptyUserMailbox,
  },
  identities: {
    save: operationSaveIdentity,
    list: operationGetIdentities,
    setSignature: operationSetSignature,
    create: operationAddIdentity,
    delete: operationDeleteIdentityNames,
  },
  signatures: {
    list: operationSignatures,
    create: operationCreateSignature,
    update: operationUpdateSignature,
    delete: operationDeleteSignature,
  },
  admin: {
    invites: {
      get: operationInvite,
      update: operationUpdateInvite,
      send: operationSendInvite,
      list: operationGetAccountRequests,
    },
    domains: {
      list: operationGetDomains,
      create: operationAddDomain,
      delete: operationDeleteDomain,
      get: operationGetDomain,
      dnsCsv: operationGetDomainDnsCsv,
      dnsJson: operationGetDomainDnsJson,
      dnsZone: operationGetDomainDnsZone,
      ownershipRecord: operationGetDomainOwnershipRecord,
      enabled: operationGetEnabledDomains,
      setEnabled: operationSetDomainEnabled,
      update: operationUpdateDomain,
      verify: operationVerifyDomain,
    },
    members: {
      list: operationGetMembers,
      create: operationAddMember,
      addEmail: operationAddMemberEmail,
      changePassword: operationChangeMemberPassword,
      deleteAccountRequests: operationDeleteAccountRequests,
      delete: operationDeleteMembers,
      disable: operationDisableMembers,
      enable: operationEnableMembers,
      options: operationGetAccountOptions,
      accounts: operationGetAccounts,
      get: operationGetMember,
      removeEmail: operationRemoveMemberEmail,
      setEmailEnabled: operationSetMemberEmailEnabled,
      setReceivingEnabled: operationSetMemberReceivingEnabled,
      update: operationUpdateMember,
    },
    groups: {
      list: operationGetGroups,
      create: operationAddGroup,
      addEmail: operationAddGroupEmail,
      addMembers: operationAddGroupMembers,
      addMemberToGroups: operationAddMemberToGroups,
      delete: operationDeleteGroups,
      get: operationGetGroup,
      removeEmail: operationRemoveGroupEmail,
      removeMember: operationRemoveGroupMember,
      removeMemberFromGroup: operationRemoveMemberFromGroup,
      setEmailEnabled: operationSetGroupEmailEnabled,
      setReceivingEnabled: operationSetGroupReceivingEnabled,
      update: operationUpdateGroup,
    },
    mailingLists: {
      list: operationGetMailingLists,
      create: operationAddMailingList,
      addEmail: operationAddMailingListEmail,
      addRecipients: operationAddMailingListRecipients,
      addMemberToMailingLists: operationAddMemberToMailingLists,
      delete: operationDeleteMailingLists,
      get: operationGetMailingList,
      removeEmail: operationRemoveMailingListEmail,
      removeRecipient: operationRemoveMailingListRecipient,
      removeMemberFromMailingList: operationRemoveMemberFromMailingList,
      setEmailEnabled: operationSetMailingListEmailEnabled,
      update: operationUpdateMailingList,
    },
    recipients: {
      list: operationGetMailingListRecipients,
    },
    dmarc: {
      list: operationGetDmarcReports,
      get: operationGetDmarcReport,
      summary: operationGetDmarcSummary,
    },
    tls: {
      list: operationGetTlsReports,
      get: operationGetTlsReport,
      summary: operationGetTlsSummary,
    },
    overview: {
      get: operationGetOverview,
    },
  },
  contacts: {
    get: operationContact,
    update: operationUpdateContact,
    suggest: operationGetEmailSuggestions,
    list: operationGetContactCards,
    emails: operationGetContacts,
    create: operationAddContactCard,
    delete: operationDeleteContactCards,
    addToBook: operationContactCardAddToAddressBook,
    removeFromBook: operationContactCardRemoveFromAddressBook,
  },
  addressBooks: {
    get: operationBook,
    update: operationUpdateBook,
    list: operationGetAddressBooks,
    contactCount: operationGetAddressBookContactCount,
    create: operationAddAddressBook,
    delete: operationDeleteAddressBooks,
  },
  account: {
    get: operationGetUserInfo,
  },
  unified: {
    folders: operationGetUnifiedFolders,
    threads: operationGetUnifiedThreads,
  },
  participantIdentities: {
    list: operationGetParticipantIdentities,
    create: operationAddParticipantIdentity,
    update: operationUpdateParticipantIdentity,
    delete: operationDeleteParticipantIdentities,
  },
  screening: {
    list: operationGetScreenedAddresses,
    global: operationGetGlobalScreenedAddresses,
    set: operationScreenEmailAddresses,
    remove: operationUnscreenEmailAddresses,
    setAddress: operationScreenEmailAddress,
    block: operationBlockSenders,
    junkInbox: operationJunkSendersInboxMail,
  },
  sieve: {
    list: operationGetSieveScripts,
    create: operationCreateSieveScript,
    update: operationUpdateSieveScript,
    delete: operationDeleteSieveScript,
    createAutomation: operationCreateAutomationScript,
    rebuildAutomation: operationRebuildAutomationScriptForAccount,
  },
  calendar: {
    clientConfig: operationGetCalendarClientConfig,
    import: operationCreateCalendarImport,
    export: operationCreateCalendarExport,
    ongoingExchange: operationOngoingCalendarExchange,
  },
  public: {
    branding: operationGetBranding,
    signupSettings: operationGetSignupSettings,
    signupDomains: operationGetSignupDomains,
    checkEmail: operationValidateEmailAssigned,
    signup: operationSignup,
    resendCode: operationResendOtp,
    verifyCode: operationVerifyOtp,
    accountRequest: operationGetAccountRequest,
    accountOptions: operationGetAccountSetupOptions,
    createAccount: operationCreateAccount,
    sendResetLink: operationSendResetPasswordLink,
    resetAccount: operationGetUserForResetPasswordKey,
  },
  attachments: {
    download: operationFetchAttachment,
    zip: operationFetchAttachmentsAsZip,
  },
  vacation: {
    get: operationGetVacationResponse,
    update: operationUpdateVacationResponse,
  },
  threads: {
    list: operationGetThreads,
    get: operationGetThread,
  },
  messages: {
    search: operationSearchMails,
    mime: operationGetMimeMessage,
    deliveryStatus: operationGetDeliveryStatus,
    create: operationCreateMail,
    updateDraft: operationUpdateDraftMail,
    deleteDraft: operationDeleteMail,
    flag: operationSetFlagged,
    seen: operationSetMailsSeen,
    move: operationMoveMails,
    addToFolder: operationAddMailsToMailbox,
    removeFromFolder: operationRemoveMailsFromMailbox,
    setFolders: operationSetMailsMailboxes,
    spam: operationSetMailsSpamStatus,
    delete: operationDeleteMessages,
    download: operationFetchMailAsEml,
  },
  screener: {
    allow: operationAllowScreeningSenders,
    reject: operationScreenOutSenders,
    undo: operationUndoScreeningVerdict,
  },
  scheduled: {
    list: operationGetSubmissions,
    get: operationGetScheduledMail,
    reschedule: operationRescheduleMail,
    sendNow: operationSendScheduledMailNow,
    cancel: operationCancelScheduledMail,
    retry: operationRetryFailedMail,
    dismiss: operationDismissFailedMail,
  },
  push: {
    list: operationFetchPushSubscriptions,
    create: operationAddPushSubscription,
    renew: operationRenewPushSubscription,
    delete: operationDeletePushSubscriptions,
  },
} as const
