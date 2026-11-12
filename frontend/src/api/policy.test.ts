/** A catalog cannot ship a mutation without an owner decision about its readers. */
import { describe, expect, it } from 'vitest'

import { api } from '@/api'
import { registration as calendar } from '@/apps/calendar/client/policy'
import { registration as draw } from '@/apps/draw/client/policy'
import { registration as drive } from '@/apps/drive/client/policy'
import { registration as mail } from '@/apps/mail/client/policy'
import { registration as meet } from '@/apps/meet/client/policy'
import { registration as sheets } from '@/apps/sheets/client/policy'
import { registration as slides } from '@/apps/slides/client/policy'
import { registration as writer } from '@/apps/writer/client/policy'
import type { OwnerRegistration } from '@/platform/server-state'
import type { Operation } from '@/platform/transport'
import { registration as suite } from '@/platform/transport/policy'

const owners = new Map<string, OwnerRegistration>(
  Object.entries({
    suite,
    drive,
    draw,
    mail,
    meet,
    calendar,
    writer,
    sheets,
    slides,
  }),
)
function operations(value: unknown): Operation[] {
  if (typeof value !== 'object' || value === null) return []
  if ('kind' in value && 'id' in value) {
    if (value.kind === 'transfer') return []
    if ((value.kind !== 'query' && value.kind !== 'mutation') || typeof value.id !== 'string') {
      throw new Error('Invalid generated operation reference')
    }
    // SAFETY: The only caller walks the generated api registry, whose remaining
    // descriptor fields are checked by contract generation; kind/id identify its leaves.
    return [value as Operation]
  }
  return Object.values(value).flatMap(operations)
}
describe('owner registrations', () => {
  it('covers every generated mutation and names existing readers', () => {
    const references = operations(api)
    const known = new Set(
      references.flatMap((ref) => [ref.id, `${ref.owner}.${ref.id}`, ref.entity?.tag]),
    )
    for (const reference of references) {
      const owner = owners.get(reference.owner)
      expect(owner, reference.owner).toBeDefined()
      if (!owner) throw new Error(`Missing owner: ${reference.owner}`)
      const policy = owner.policy(reference)
      if (reference.kind === 'mutation') expect(policy.effects, reference.publicName).toBeDefined()
      if (typeof policy.effects === 'object' && Array.isArray(policy.effects.invalidates)) {
        for (const reader of policy.effects.invalidates)
          expect(known.has(reader), reader).toBe(true)
      }
    }
  })
})
