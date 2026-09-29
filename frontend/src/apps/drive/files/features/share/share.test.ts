import { describe, expect, it, vi } from 'vitest'

import { rolesFor, type DriveGrant, type GrantList } from '@/apps/drive/client/grants'
import { openDriveDocumentSession } from '@/apps/drive/client/session'
import type { Transport } from '@/platform/transport'

import { shareSections } from './shareModel'
import { useShare } from './useShare'

const NOW = new Date('2026-09-30T12:00:00')

const grant = (principal: string, role: number, extra: Partial<DriveGrant> = {}): DriveGrant => ({
  name: `g-${principal}`, node: 'doc', principal, role, expires_on: null, has_password: false, sent_to: null, ...extra,
})

const node = (kind: string, role = 50) => ({
  name: 'doc', title: 'Plan', kind, parent: 'folder', root: 'root', state: 'Active', size: 0, mime: null, url: null,
  content_doctype: kind === 'document' ? 'Writer Document' : null, content_docname: kind === 'document' ? 'w1' : null,
  is_template: 0, owner: 'asha@example.com', creation: null, modified: null, content_modified: null,
  access: { role },
})

interface Call { id: string; input: Record<string, unknown> }

/** A fake server: answers by operation id and records every call. */
function fakeServer(answer: (call: Call) => unknown) {
  const calls: Call[] = []
  const transport: Transport = {
    request: async (operation, input) => {
      const call = { id: operation.id, input: input as Record<string, unknown> }
      calls.push(call)
      const result = answer(call)
      if (result instanceof Error) throw result
      return result as never
    },
  }
  return { calls, transport }
}

describe('roles offered (spec §7.5)', () => {
  it('offers Upload only where there are items to add, Manage only to people, and View only to the public', () => {
    const labels = (kind: Parameters<typeof rolesFor>[0], nodeKind: string) => rolesFor(kind, nodeKind).map((role) => role.label)
    expect(labels('user', 'folder')).toEqual(['View', 'Comment', 'Upload', 'Edit', 'Manage'])
    expect(labels('group', 'document')).toEqual(['View', 'Comment', 'Edit', 'Manage'])
    expect(labels('general', 'folder')).toEqual(['View', 'Comment', 'Upload', 'Edit'])
    expect(labels('general', 'file')).toEqual(['View', 'Comment', 'Edit'])
    expect(labels('public', 'folder')).toEqual(['View'])
    expect(labels('link', 'document')).toEqual(['View', 'Comment', 'Edit'])
  })
})

describe('share sections (spec §7.3, §7.6, §7.9)', () => {
  const list: GrantList = {
    grants: [
      grant('asha@example.com', 40),
      grant('old@example.com', 10, { expires_on: '2026-09-01 23:59:59' }),
      grant('$GROUP:Design team', 0),
      grant('$LINK:abcdefghijklmnopqrstuv', 10, { has_password: true, url: '/l/abcdefghijklmnopqrstuv' }),
    ],
    inherited: [
      { grant: grant('$PUBLIC', 10, { node: 'folder' }), redacted: false, source_node: 'folder', source_title: 'Launch' },
      { grant: grant('$GROUP:Design team', 20, { node: 'folder' }), redacted: false, source_node: 'folder', source_title: 'Launch' },
      { grant: { node: 'root', principal: '$LINK', role: 10, expires_on: null, has_password: false }, redacted: true, source_node: 'root', source_title: 'My files' },
      { grant: grant('$GENERAL', 30, { node: 'root' }), redacted: false, source_node: 'root', source_title: 'My files' },
    ],
  }

  it('keeps expired rows and denies in People, and shows public access from a parent', () => {
    const sections = shareSections(list, 'document', NOW)

    expect(sections.people.map((row) => [row.grant.principal, row.expired, row.denied])).toEqual([
      ['asha@example.com', false, false],
      ['old@example.com', true, false],
      ['$GROUP:Design team', false, true],
    ])
    expect(sections.public).toMatchObject({ state: 'inherited', entry: { source_title: 'Launch' } })
    expect(sections.organization).toMatchObject({ state: 'inherited', entry: { source_title: 'My files' } })
    expect(sections.links?.map((row) => row.grant.has_password)).toEqual([true])
  })

  it('folds inherited grants per ancestor, and offers Deny only where it can apply', () => {
    const sections = shareSections(list, 'document', NOW)

    expect(sections.inherited.map((part) => [part.title, part.rows.map((row) => [row.entry.grant.principal, row.deniable])])).toEqual([
      ['Launch', [['$PUBLIC', true], ['$GROUP:Design team', false]]],
      ['My files', [['$LINK', false], ['$GENERAL', true]]],
    ])
  })

  it('hides Public on the web and Share links on a root', () => {
    const sections = shareSections({ grants: [grant('$GENERAL', 30)], inherited: [] }, 'root', NOW)

    expect(sections.public).toBeNull()
    expect(sections.links).toBeNull()
    expect(sections.organization).toMatchObject({ state: 'local' })
  })
})

describe('share writes (spec §7.4, §7.7, §7.9)', () => {
  const link = grant('$LINK:abcdefghijklmnopqrstuv', 20, { has_password: true, expires_on: '2026-12-31 23:59:59', url: '/l/abcdefghijklmnopqrstuv' })

  it('changes a link expiry without sending the password, and keeps the expiry on a role change', async () => {
    const server = fakeServer((call) =>
      call.id === 'node_get' ? node('document') : call.id === 'node_grants' ? { grants: [link], inherited: [] } : { grant: link },
    )
    const share = useShare('doc', server.transport)
    await share.load()
    const row = share.sections.value!.links![0]!

    await share.setExpiry(row, '2027-01-15')
    await share.setRole(row, 40)

    const puts = server.calls.filter((call) => call.id === 'node_put_grant').map((call) => call.input)
    expect(puts[0]).toEqual({ node: 'doc', principal: link.principal, role: 20, expires_on: '2027-01-15 23:59:59' })
    expect(puts[1]).toEqual({ node: 'doc', principal: link.principal, role: 40, expires_on: '2026-12-31 23:59:59' })
  })

  it('after Remove, reads access again and says why the person still has access', async () => {
    let grants = [grant('asha@example.com', 40)]
    const server = fakeServer((call) => {
      if (call.id === 'node_get') return node('document')
      if (call.id === 'node_delete_grant') {
        grants = []
        return { result: 'revoked' }
      }
      if (call.id === 'node_grants' && call.input.principal) {
        return { explain: { role: 20, source: 'grant', rows: [
          { node: 'folder', depth: 1, principal: '$GROUP:Design team', role: 20, expires_on: null, held: true, winner: true },
        ] } }
      }
      return { grants, inherited: [] }
    })
    const share = useShare('doc', server.transport)
    share.rememberName('asha@example.com', 'Asha')
    await share.load()

    await share.remove(share.sections.value!.people[0]!)

    expect(share.sections.value!.people).toEqual([])
    expect(share.notice.value).toBe('Asha still has access through Design team.')
  })

  it('shows a failed write on its own row and still reads the grants again', async () => {
    let reads = 0
    const server = fakeServer((call) => {
      if (call.id === 'node_get') return node('document')
      if (call.id === 'node_put_grant') return new Error('That user does not exist')
      reads += 1
      return { grants: [grant('asha@example.com', 10)], inherited: [] }
    })
    const share = useShare('doc', server.transport)
    await share.load()

    await share.setRole(share.sections.value!.people[0]!, 40)

    expect(share.errors.get('asha@example.com')).toBe('That user does not exist')
    expect(reads).toBe(2)
  })

  it('sends a link to an outsider and notifies only users', async () => {
    const server = fakeServer((call) =>
      call.id === 'node_get' ? node('folder') : call.id === 'node_grants' ? { grants: [], inherited: [] } : { grant: grant('x', 10) },
    )
    const share = useShare('doc', server.transport)
    await share.load()

    await share.sendLink('guest@example.com', 20)
    await share.add('asha@example.com', 40, true)
    await share.add('$GROUP:Design team', 20, true)

    expect(server.calls.filter((call) => call.id === 'node_put_grant').map((call) => call.input)).toEqual([
      { node: 'doc', principal: '$LINK', role: 20, send_to: 'guest@example.com' },
      { node: 'doc', principal: 'asha@example.com', role: 40, notify: true },
      { node: 'doc', principal: '$GROUP:Design team', role: 20 },
    ])
  })
})

describe('document session share (spec §8.8)', () => {
  it('opens the Drive dialog, then reads access again; Share is offered only with Manage', async () => {
    let role = 50
    const server = fakeServer(() => node('document', role))
    const opened: string[] = []
    const session = await openDriveDocumentSession('doc', {
      transport: server.transport,
      setInterval: vi.fn() as unknown as typeof setInterval,
      clearInterval: vi.fn() as unknown as typeof clearInterval,
      share: async (id) => {
        opened.push(id)
        role = 40
      },
    })
    expect(session.canShare.value).toBe(true)

    await session.share()

    expect(opened).toEqual(['doc'])
    expect(session.canShare.value).toBe(false)
    session.dispose()
  })
})
