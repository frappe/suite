import type { OwnerRegistration, Policy } from '@/platform/server-state'

function screeningPolicy(remove: boolean) {
  return {
    effects: {
      invalidates: [
        'mail.get_screened_addresses',
        'mail.get_mailboxes',
        'mail.get_unified_folders',
        'mail.inbox_summary',
      ],
      optimisticReads: {
        references: ['mail.get_screened_addresses'],
        update(input: unknown, queryInput: unknown, data: unknown) {
          if (
            !isRecord(input) ||
            typeof input.account !== 'string' ||
            !Array.isArray(input.emails) ||
            !input.emails.every((email): email is string => typeof email === 'string')
          )
            return undefined
          if (!isRecord(queryInput) || queryInput.account !== input.account || !Array.isArray(data))
            return undefined
          const addresses = new Set(input.emails.map((email) => email.toLowerCase()))
          const kept = data.filter(
            (row) =>
              !isRecord(row) ||
              typeof row.email !== 'string' ||
              !addresses.has(row.email.toLowerCase()),
          )
          if (remove) return kept
          const action = typeof input.action === 'string' ? input.action : 'Spam'
          return [
            ...kept,
            ...input.emails.map((email) => ({ email, action, creation: '', modified: '' })),
          ]
        },
      },
    },
  }
}

export const registration: OwnerRegistration = {
  policy<I, O>(reference: {
    id: string
    kind?: 'query' | 'mutation'
    publicName?: string
  }): Policy<I, O> {
    if (reference.id === 'screen_email_addresses') return screeningPolicy(false)
    if (reference.id === 'unscreen_email_addresses') return screeningPolicy(true)
    // Blocking moves mail to Junk as well as writing the rule, so it reads as a message change.
    if (['block_senders', 'junk_senders_inbox_mail'].includes(reference.id))
      return messagePolicy<I, O>(reference.id)
    if (reference.id === 'create_calendar_import' || reference.id === 'create_calendar_export')
      return { effects: { invalidates: ['mail.ongoing_calendar_exchange'] } }
    if (
      [
        'add_participant_identity',
        'update_participant_identity',
        'delete_participant_identities',
      ].includes(reference.id)
    )
      return { effects: { invalidates: ['mail.get_participant_identities'] } }
    if (['signup', 'resend_otp', 'verify_otp', 'send_reset_password_link'].includes(reference.id))
      return { effects: 'none' }
    if (reference.id === 'create_account')
      return {
        effects: {
          invalidates: [
            'mail.get_account_request',
            'mail.get_account_setup_options',
            'mail.get_user_info',
          ],
        },
      }
    if (['create_mailbox', 'update_mailbox', 'delete_mailbox'].includes(reference.id))
      return {
        effects: {
          matches: matchingAccount,
          invalidates: ['mail.get_mailboxes', 'mail.get_unified_folders', 'mail.get_sieve_scripts'],
        },
      }
    if (
      [
        'create_sieve_script',
        'update_sieve_script',
        'delete_sieve_script',
        'create_automation_script',
        'rebuild_automation_script_for_account',
      ].includes(reference.id)
    )
      return {
        effects: {
          invalidates: [
            'mail.get_sieve_scripts',
            'mail.get_mailboxes',
            'mail.get_vacation_response',
          ],
        },
      }
    if (reference.id === 'update_vacation_response')
      return {
        effects: {
          matches: matchingAccount,
          invalidates: ['mail.get_vacation_response', 'mail.get_sieve_scripts'],
        },
      }
    if (reference.id === 'set_signature')
      return { effects: { invalidates: ['mail.get_identities'] } }
    if (reference.id === 'screen_email_address') return screeningPolicy(false)
    if (
      [
        'create_mail_import',
        'create_mail_export',
        'create_contacts_import',
        'create_contacts_export',
      ].includes(reference.id)
    )
      return { effects: { invalidates: ['mail.ongoing_exchange', 'mail.exchange_list'] } }
    if (reference.id === 'update_preferences')
      return {
        effects: {
          invalidates: ['mail.get_user_info'],
          optimisticReads: {
            references: ['mail.get_user_info'],
            update(input, _query, data) {
              return isRecord(input) && isRecord(data) ? { ...data, ...input } : undefined
            },
          },
        },
      }
    if (reference.id === 'update_credentials')
      return {
        effects: {
          invalidates: [
            'mail.credentials',
            'mail.get_user_info',
            'mail.get_calendar_client_config',
            'mail.get_mail_client_config',
          ],
        },
      }
    if (reference.id === 'update_account_preferences')
      return {
        effects: {
          invalidates: [
            'mail.account_preferences',
            'mail.get_user_info',
            'mail.get_mailboxes',
            'mail.get_sieve_scripts',
          ],
          matches: matchingAccount,
          optimisticReads: {
            references: ['mail.get_user_info'],
            update(input, _query, data) {
              if (
                !isRecord(input) ||
                !isRecord(input.changes) ||
                !isRecord(data) ||
                !Array.isArray(data.accounts)
              )
                return undefined
              return {
                ...data,
                accounts: data.accounts.map((account) =>
                  isRecord(account) && account.id === input.account
                    ? { ...account, ...(input.changes as Record<string, unknown>) }
                    : account,
                ),
              }
            },
          },
        },
      }
    if (reference.id === 'subscribe_mailbox')
      return { effects: { invalidates: ['mail.get_mailboxes', 'mail.get_unified_folders'] } }
    if (reference.kind === 'mutation' && reference.publicName?.startsWith('admin.')) {
      if (reference.id === 'change_member_password') return { effects: 'none' }
      const domain = reference.publicName.startsWith('admin.domains.')
      const readers = domain
        ? [
            'get_domains',
            'get_domain',
            'get_enabled_domains',
            'get_domain_ownership_record',
            'get_domain_dns_zone',
            'get_domain_dns_csv',
            'get_domain_dns_json',
          ]
        : [
            'invite',
            'get_members',
            'get_member',
            'get_accounts',
            'get_account_requests',
            'get_groups',
            'get_group',
            'get_mailing_lists',
            'get_mailing_list',
            'get_mailing_list_recipients',
          ]
      return {
        effects: {
          invalidates: [
            ...[...readers, 'get_overview'].map((id) => `mail.${id}`),
            'suite.users_get',
            'suite.account_get',
            'suite.storage_get',
          ],
          matches: matchingAdminTarget,
        },
      }
    }
    if (['add_identity', 'delete_identity_names', 'save_identity'].includes(reference.id))
      return { effects: { invalidates: ['mail.get_identities'] } }
    if (['create_signature', 'update_signature', 'delete_signature'].includes(reference.id))
      return { effects: { invalidates: ['mail.signatures'] } }
    if (
      reference.kind === 'mutation' &&
      (reference.publicName?.startsWith('contacts.') ||
        reference.publicName?.startsWith('addressBooks.'))
    )
      return {
        effects: {
          matches: matchingAccount,
          invalidates: [
            'mail.contact',
            'mail.book',
            'mail.get_contact_cards',
            'mail.get_contacts',
            'mail.get_address_books',
            'mail.get_address_book_contact_count',
            'mail.get_email_suggestions',
          ],
        },
      }
    if (
      (reference.kind === 'mutation' &&
        ['messages.', 'screener.', 'scheduled.'].some((prefix) =>
          reference.publicName?.startsWith(prefix),
        )) ||
      reference.id === 'empty_user_mailbox'
    )
      return messagePolicy<I, O>(reference.id)
    if (reference.kind === 'mutation' && reference.publicName?.startsWith('push.'))
      return { effects: { invalidates: ['mail.fetch_push_subscriptions'] } }
    return { staleTime: 30_000 }
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function matchingAccount(input: unknown, queryInput: unknown): boolean {
  return (
    !isRecord(input) ||
    !isRecord(queryInput) ||
    !('account' in queryInput) ||
    input.account === queryInput.account
  )
}

function matchingAdminTarget(input: unknown, queryInput: unknown): boolean {
  if (!isRecord(input) || !isRecord(queryInput)) return true
  for (const field of ['domain_id', 'member_id', 'group_id', 'list_id']) {
    const target = queryInput[field]
    if (typeof target !== 'string') continue
    if (typeof input[field] === 'string') return input[field] === target
    for (const values of [
      input.ids,
      input.names,
      input.account_ids,
      input.group_ids,
      input.list_ids,
    ]) {
      if (Array.isArray(values)) return values.includes(target)
    }
  }
  return true
}

const messageReaders = [
  'get_threads',
  'get_unified_threads',
  'get_thread',
  'search_mails',
  'get_mailboxes',
  'get_unified_folders',
  'get_all_inbox_unread_count',
  'inbox_summary',
  'get_submissions',
  'get_scheduled_mail',
].map((id) => `mail.${id}`)

function messagePolicy<I, O>(id: string): Policy<I, O> {
  return {
    effects: {
      matches: matchingAccount,
      invalidates: [
        ...messageReaders,
        'mail.get_screened_addresses',
        'mail.get_contacts',
        'mail.get_contact_cards',
        'mail.get_email_suggestions',
      ],
      optimisticReads: {
        references: messageReaders,
        update(input, queryInput, data) {
          if (!isRecord(input) || !matchingAccount(input, queryInput)) return undefined
          const ids = new Set(Array.isArray(input.ids) ? input.ids : [])
          if (Array.isArray(input.names))
            for (const name of input.names)
              if (typeof name === 'string') ids.add(name.split('|').at(-1))
          if (typeof input.id === 'string') ids.add(input.id)
          if (
            ['allow_screening_senders', 'screen_out_senders'].includes(id) &&
            Array.isArray(data) &&
            Array.isArray(input.from_emails)
          ) {
            const senders = new Set(input.from_emails)
            return data.filter((row) => !isRecord(row) || !senders.has(row.from_email))
          }
          const field =
            id === 'set_mails_seen' ? 'seen' : id === 'set_flagged' ? 'flagged' : undefined
          const patch = (row: unknown): unknown => {
            if (
              !isRecord(row) ||
              (typeof row.account === 'string' &&
                typeof input.account === 'string' &&
                row.account !== input.account)
            )
              return row
            const messages = Array.isArray(row.messages) ? row.messages.map(patch) : undefined
            if (!field) return row
            return {
              ...row,
              ...(messages ? { messages } : {}),
              ...(ids.has(row.id) ? { [field]: input[field] ? 1 : 0 } : {}),
            }
          }
          if (field) {
            if (Array.isArray(data)) return data.map(patch)
            if (isRecord(data) && Array.isArray(data.rows))
              return { ...data, rows: data.rows.map(patch) }
          }
          if (!isRecord(queryInput) || !isRecord(data) || !Array.isArray(data.rows))
            return undefined
          const removing = [
            'move_mails',
            'delete_messages',
            'delete_mail',
            'empty_user_mailbox',
          ].includes(id)
          if (
            !removing ||
            (id === 'move_mails' &&
              (input.mailbox === queryInput.mailbox ||
                (input.mailbox === 'inbox' && queryInput.folder === 'inbox')))
          )
            return undefined
          return {
            ...data,
            rows: data.rows.filter((row) => {
              if (!isRecord(row)) return true
              if (
                typeof queryInput.account === 'string' &&
                typeof input.account === 'string' &&
                input.account !== queryInput.account
              )
                return true
              if (
                typeof row.account === 'string' &&
                typeof input.account === 'string' &&
                row.account !== input.account
              )
                return true
              if (id === 'empty_user_mailbox') return queryInput.mailbox !== input.mailbox
              return (
                !ids.has(row.id) &&
                (!Array.isArray(row.messages) ||
                  !row.messages.every((message) => isRecord(message) && ids.has(message.id)))
              )
            }),
          }
        },
      },
    },
  }
}
