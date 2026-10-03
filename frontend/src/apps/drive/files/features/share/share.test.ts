import { describe, expect, it, vi } from 'vitest'

import { rolesFor, type DriveGrant, type ExplainRow, type GrantList } from '@/apps/drive/client/grants'
import { openDriveDocumentSession } from '@/apps/drive/client/session'
import type { Transport } from '@/platform/transport'

import { shareSections } from './shareModel'
import { useShare } from './useShare'

const NOW = new Date('2026-09-30T12:00:00')
/** The server's RFC 3339 UTC form of the end of a day in this zone (Drive spec §11.3). */
const endOfDay = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 23, 59, 59).toISOString().replace('.000Z', 'Z')

const grant = (principal: string, role: number, extra: Partial<DriveGrant> = {}): DriveGrant => ({
  name: `g-${principal}`, node: 'doc', principal, role, expires_on: null, has_password: false, sent_to: null, ...extra,
})

const node = (kind: string, role = 50) => ({
  name: 'doc', title: 'Plan', kind, parent_node: 'folder', root: 'root', state: 'Active', trash_root: null, size: 0, mime: null, url: null,
  content_doctype: kind === 'document' ? 'Writer Document' : null, content_docname: kind === 'document' ? 'w1' : null,
  is_template: 0, owner: { id: 'asha@example.com', full_name: 'Asha', user_image: null }, creation: null, modified: null, content_modified: null,
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
      grant('old@example.com', 10, { expires_on: endOfDay(2026, 9, 1) }),
      grant('$GROUP:Design team', 0),
      grant('$LINK:abcdefghijklmnopqrstuv', 10, { has_password: true, url: '/l/abcdefghijklmnopqrstuv' }),
    ],
    inherited: [
      { grant: grant('$PUBLIC', 10, { node: 'folder' }), redacted: false, source_node: 'folder', source_title: 'Launch' },
      { grant: grant('$GROUP:Design team', 20, { node: 'folder' }), redacted: false, source_node: 'folder', source_title: 'Launch' },
      { grant: grant('$LINK:launchlinklaunchlink12', 10, { node: 'folder' }), redacted: false, source_node: 'folder', source_title: 'Launch' },
      { grant: { node: 'root', principal: '$LINK', role: 10, expires_on: null, has_password: false }, redacted: true, source_node: 'root', source_title: 'My files' },
      { grant: grant('$GENERAL', 30, { node: 'root' }), redacted: false, source_node: 'root', source_title: 'My files' },
    ],
    owner: null,
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

  it('keeps an expired org-wide row greyed with Remove, and says what applies meanwhile', () => {
    const sections = shareSections(
      { grants: [grant('$GENERAL', 40, { expires_on: endOfDay(2026, 9, 1) })], inherited: list.inherited, owner: null },
      'document',
      NOW,
    )

    expect(sections.organization).toMatchObject({
      state: 'expired',
      row: { expired: true, grant: { principal: '$GENERAL' } },
      entry: { source_title: 'My files' },
    })
  })

  it('folds inherited grants per ancestor, and offers Deny only where it can apply', () => {
    const sections = shareSections(list, 'document', NOW)

    expect(sections.inherited.map((part) => [part.title, part.rows.map((row) => [row.entry.grant.principal, row.deniable])])).toEqual([
      ['Launch', [['$PUBLIC', true], ['$GROUP:Design team', false], ['$LINK:launchlinklaunchlink12', true]]],
      ['My files', [['$LINK', false], ['$GENERAL', true]]],
    ])
  })

  it('lists the owner once, first, with nothing to deny or remove', () => {
    const owner = { id: 'faris@example.com', full_name: 'Faris', user_image: null }
    const ownGrant = (node: string) => grant(owner.id, 50, { node })
    const inFolder = shareSections(
      {
        grants: [grant('asha@example.com', 40)],
        inherited: [
          { grant: ownGrant('root'), redacted: false, source_node: 'root', source_title: 'Faris' },
          { grant: grant('$GENERAL', 10, { node: 'folder' }), redacted: false, source_node: 'folder', source_title: 'Launch' },
        ],
        owner,
      },
      'document',
      NOW,
    )

    expect(inFolder.owner).toEqual(owner)
    expect(inFolder.people.map((row) => row.grant.principal)).toEqual(['asha@example.com'])
    // The root held only the owner's grant, so it folds away.
    expect(inFolder.inherited.map((part) => part.title)).toEqual(['Launch'])

    const onRoot = shareSections({ grants: [ownGrant('root')], inherited: [], owner }, 'root', NOW)
    expect(onRoot.owner).toEqual(owner)
    expect(onRoot.people).toEqual([])
  })

  it('hides Public on the web and Share links on a root', () => {
    const sections = shareSections({ grants: [grant('$GENERAL', 30)], inherited: [], owner: null }, 'root', NOW)

    expect(sections.public).toBeNull()
    expect(sections.links).toBeNull()
    expect(sections.organization).toMatchObject({ state: 'local' })
  })
})

describe('share writes (spec §7.4, §7.7, §7.9)', () => {
  const link = grant('$LINK:abcdefghijklmnopqrstuv', 20, { has_password: true, expires_on: endOfDay(2026, 12, 31), url: '/l/abcdefghijklmnopqrstuv' })

  it('changes a link by its grant id: an expiry without sending the password, and a role keeping the expiry', async () => {
    const server = fakeServer((call) =>
      call.id === 'node_get' ? node('document') : call.id === 'node_grants' ? { grants: [link], inherited: [] } : link,
    )
    const share = useShare('doc', { transport: server.transport })
    await share.load()
    const row = share.sections.value!.links![0]!

    await share.setExpiry(row, '2027-01-15')
    await share.setRole(row, 40)
    await share.remove(row)

    const writes = server.calls.filter((call) => call.id.startsWith('grant_')).map((call) => [call.id, call.input])
    expect(writes).toEqual([
      ['grant_patch', { grant: link.name, role: 20, expires_on: endOfDay(2027, 1, 15) }],
      ['grant_patch', { grant: link.name, role: 40, expires_on: endOfDay(2026, 12, 31) }],
      ['grant_delete', { grant: link.name }],
    ])
    expect(server.calls.some((call) => call.id === 'node_put_grant' || call.id === 'node_delete_grant')).toBe(false)
    expect(share.changed.value).toBe(true)
  })

  it('after Remove, reads access again and says why the person still has access', async () => {
    let grants = [grant('asha@example.com', 40)]
    const server = fakeServer((call) => {
      if (call.id === 'node_get') return node('document')
      if (call.id === 'node_delete_grant') {
        grants = []
        return { count: 1 }
      }
      if (call.id === 'node_grants' && call.input.principal) {
        return { explain: { role: 20, source: 'grant', rows: [
          { node: 'folder', depth: 1, principal: '$GROUP:Design team', role: 20, expires_on: null, held: true, winner: true },
        ] } }
      }
      return { grants, inherited: [] }
    })
    const share = useShare('doc', { transport: server.transport })
    share.rememberName('asha@example.com', 'Asha')
    await share.load()

    await share.remove(share.sections.value!.people[0]!)

    expect(share.sections.value!.people).toEqual([])
    expect(share.notice.value).toBe('Asha still has access through Design team.')
  })

  it('names the owner, the people the grants name, and the organization in its words', async () => {
    const asha = { id: 'asha@example.com', full_name: 'Asha Rao', user_image: '/files/asha.png' }
    const server = fakeServer((call) =>
      call.id === 'node_get'
        ? node('document')
        : {
            grants: [grant(asha.id, 40, { person: asha })],
            inherited: [],
            owner: { id: 'faris@example.com', full_name: 'Faris Ansari', user_image: null },
          },
    )
    const share = useShare('doc', { transport: server.transport, workspace: 'Frappe' })
    await share.load()

    expect(share.label('faris@example.com')).toBe('Faris Ansari')
    expect(share.label(asha.id)).toBe('Asha Rao')
    expect(share.sections.value!.people[0]!.grant.person).toEqual(asha)
    expect(share.organization.value).toBe('Everyone at Frappe')
    expect(useShare('doc', { transport: server.transport }).organization.value).toBe('Everyone in your organization')
  })

  it('names an ancestor by its place for the caller, in the fold and in its words', async () => {
    const server = fakeServer((call) =>
      call.id === 'node_get'
        ? node('document')
        : {
            grants: [],
            inherited: [{ grant: grant('$GENERAL', 10, { node: 'root' }), redacted: false, source_node: 'root', source_title: 'Faris Ansari' }],
            owner: null,
          },
    )
    const placeTitle = (place: { name: string; title: string }) => (place.name === 'root' ? 'My files' : place.title)
    const share = useShare('doc', { transport: server.transport, placeTitle })
    await share.load()

    expect(share.sections.value!.inherited.map((part) => part.title)).toEqual(['My files'])
    expect(share.sections.value!.organization).toMatchObject({ state: 'inherited', entry: { source_title: 'My files' } })
  })

  it('shows a failed write on its own row and still reads the grants again', async () => {
    let reads = 0
    const server = fakeServer((call) => {
      if (call.id === 'node_get') return node('document')
      if (call.id === 'node_put_grant') return new Error('That user does not exist')
      reads += 1
      return { grants: [grant('asha@example.com', 10)], inherited: [] }
    })
    const share = useShare('doc', { transport: server.transport })
    await share.load()

    await share.setRole(share.sections.value!.people[0]!, 40)

    expect(share.errors.get('asha@example.com')).toBe('That user does not exist')
    expect(reads).toBe(2)
    // Nothing changed, so the opener has nothing to refresh.
    expect(share.changed.value).toBe(false)
  })

  it('sends a link to an outsider and notifies only users', async () => {
    const server = fakeServer((call) =>
      call.id === 'node_get' ? node('folder') : call.id === 'node_grants' ? { grants: [], inherited: [] } : grant('x', 10),
    )
    const share = useShare('doc', { transport: server.transport })
    await share.load()

    await share.sendLink('guest@example.com', 20)
    await share.add(['asha@example.com', '$GROUP:Design team'], 40, true)

    expect(server.calls.filter((call) => call.id === 'node_put_grant').map((call) => call.input)).toEqual([
      { node: 'doc', principal: '$LINK', role: 20, send_to: 'guest@example.com' },
      { node: 'doc', principal: 'asha@example.com', role: 40, notify: true },
      { node: 'doc', principal: '$GROUP:Design team', role: 40 },
    ])
  })

  it('keeps the error of every person it could not add, and says who each one is about', async () => {
    const server = fakeServer((call) => {
      if (call.id === 'node_get') return node('document')
      if (call.id === 'node_put_grant' && call.input.principal !== 'leah@example.com') return new Error('That user is disabled')
      return call.id === 'node_grants' ? { grants: [], inherited: [] } : { grant: grant('leah@example.com', 20) }
    })
    const share = useShare('doc', { transport: server.transport })
    share.rememberName('maya@example.com', 'Maya Rao')
    await share.load()

    const left = await share.add(['maya@example.com', 'leah@example.com', 'kenji@example.com'], 20, false)

    expect(left).toEqual(['maya@example.com', 'kenji@example.com'])
    expect(share.errors.get('picker')).toBe('Maya Rao: That user is disabled\nkenji@example.com: That user is disabled')
  })
})

describe('share writes that touch the caller (spec §7.4, §7.9)', () => {
  const ME = 'asha@example.com'
  const row = (node: string, depth: number, principal: string, role: number, held = true): ExplainRow => ({
    node, depth, principal, role, expires_on: null, pass: principal === '$PUBLIC' || principal.startsWith('$LINK') ? 2 : 1, held, winner: false,
  })

  /** A node `doc` under `folder` under `root`, and a caller whose explanation is `rows`. */
  function setup(local: DriveGrant[], rows: ExplainRow[], role = 50) {
    const server = fakeServer((call) => {
      if (call.id === 'node_get') return node('document')
      if (call.id === 'node_grants' && call.input.principal) return { explain: { role, source: 'grant', rows } }
      if (call.id === 'node_grants') return { grants: local, inherited: [] }
      if (call.id === 'node_delete_grant') return { count: 3 }
      return { grant: local[0] }
    })
    const asked: number[] = []
    let answer = false
    const share = useShare('doc', {
      transport: server.transport,
      me: ME,
      confirmLoss: async () => {
        asked.push(1)
        return answer
      },
    })
    const writes = () => server.calls.filter((call) => call.id === 'node_put_grant' || call.id === 'node_delete_grant')
    return { share, asked, writes, agree: () => (answer = true) }
  }

  it('asks before removing the group that gives the caller Manage, and writes nothing if they decline', async () => {
    const leads = grant('$GROUP:Leads', 50)
    const { share, asked, writes, agree } = setup([leads], [row('root', 0, '$GENERAL', 40), row('doc', 2, '$GROUP:Leads', 50)])
    await share.load()

    await share.remove(share.sections.value!.people[0]!)
    expect(asked).toHaveLength(1)
    expect(writes()).toEqual([])

    agree()
    await share.remove(share.sections.value!.people[0]!)
    expect(writes().map((call) => call.id)).toEqual(['node_delete_grant'])
  })

  it('asks before denying here an inherited grant the caller holds, but not one they do not hold', async () => {
    const { share, asked, writes } = setup(
      [],
      [row('folder', 1, ME, 50), row('folder', 1, '$GROUP:Sales', 20, false)],
    )
    await share.load()

    await share.deny('$GROUP:Sales')
    expect(asked).toHaveLength(0)
    await share.deny(ME)
    expect(asked).toHaveLength(1)
    expect(writes().map((call) => call.input.principal)).toEqual(['$GROUP:Sales'])
  })

  it('does not ask when the caller keeps Manage through their own row', async () => {
    const { share, asked, writes } = setup(
      [grant(ME, 50), grant('$GROUP:Leads', 50)],
      [row('doc', 2, ME, 50), row('doc', 2, '$GROUP:Leads', 50)],
    )
    await share.load()

    await share.setRole(share.sections.value!.people[1]!, 10)
    expect(asked).toHaveLength(0)
    expect(writes()).toHaveLength(1)
  })

  it('keeps the org-wide expiry on a role change, and counts only the items inside', async () => {
    const general = grant('$GENERAL', 10, { expires_on: endOfDay(2027, 3, 1) })
    const { share, writes } = setup([general, grant('bo@example.com', 20)], [row('doc', 2, ME, 50)])
    share.rememberName('bo@example.com', 'Bo')
    await share.load()

    await share.setGeneral('$GENERAL', 20)
    await share.remove(share.sections.value!.people[0]!, true)

    expect(writes()[0]!.input).toEqual({ node: 'doc', principal: '$GENERAL', role: 20, expires_on: endOfDay(2027, 3, 1) })
    expect(share.notice.value).toMatch(/^Removed from 2 items inside\./)
  })

  it('keeps the newest read when an older one answers last', async () => {
    const answers: ((value: unknown) => void)[] = []
    const transport: Transport = {
      request: (operation) =>
        operation.id === 'node_get'
          ? (new Promise((resolve) => answers.push(resolve)) as never)
          : (Promise.resolve({ grants: [], inherited: [] }) as never),
    }
    const share = useShare('doc', { transport })

    const first = share.load()
    const second = share.load()
    answers[1]!({ ...node('document'), title: 'New' })
    await second
    answers[0]!({ ...node('document'), title: 'Old' })
    await first

    expect(share.node.value?.title).toBe('New')
  })
})

describe('document session share (spec §8.6, §8.8)', () => {
  it('reads access again after each write in the dialog, before it closes; Share is offered only with Manage', async () => {
    let role = 50
    const server = fakeServer((call) => {
      if (call.id === 'node_get') return node('document', role)
      if (call.id === 'node_grants') return { grants: [grant('asha@example.com', 50)], inherited: [] }
      if (call.id === 'node_put_grant') role = 40
      return grant('asha@example.com', 40)
    })
    let whileOpen: boolean | undefined
    const session = await openDriveDocumentSession('doc', {
      transport: server.transport,
      setInterval: vi.fn() as unknown as typeof setInterval,
      clearInterval: vi.fn() as unknown as typeof clearInterval,
      share: async (id) => {
        const share = useShare(id, { transport: server.transport })
        await share.load()
        await share.setRole(share.sections.value!.people[0]!, 40)
        await Promise.resolve()
        whileOpen = session.canShare.value
      },
    })
    expect(session.canShare.value).toBe(true)

    await session.share()

    expect(whileOpen).toBe(false)
    expect(session.canShare.value).toBe(false)
    session.dispose()
  })
})
