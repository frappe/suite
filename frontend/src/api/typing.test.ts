import { expectTypeOf, it } from 'vitest'

import { api, client, useInfiniteQuery, useMutation, useQuery, useUpload } from './index'

it('keeps input, output, kind, and capability types on lazy references', () => {
  function callers(file: Blob) {
    expectTypeOf(client.query(api.mail.inbox.summary)).toEqualTypeOf<Promise<{ unread: number }>>()
    useQuery(api.suite.account.get)
    useQuery(api.drive.nodes.get, () => false)
    useInfiniteQuery(api.suite.people.list, { q: 'a' })
    useMutation(api.drive.nodes.rename).run({ node: 'budget', title: 'Forecast' })
    useUpload(api.drive.uploads.transfer).run({ parent_node: 'root', file })
    // @ts-expect-error A mutation is not a query.
    useQuery(api.drive.nodes.rename, { node: 'budget', title: 'Forecast' })
    // @ts-expect-error A query is not a mutation.
    client.mutation(api.drive.nodes.get, { node: 'budget' })
    // @ts-expect-error A required node cannot be omitted.
    client.query(api.drive.nodes.get)
    // @ts-expect-error Only page references support infinite reads.
    useInfiniteQuery(api.mail.inbox.summary)
    // @ts-expect-error A transfer requires bytes.
    useUpload(api.drive.uploads.transfer).run({ parent_node: 'root' })
    // @ts-expect-error Covered satellite operations require their domain node.
    client.mutation(api.drive.grants.rotate, { grant: 'g' })
  }
  expectTypeOf(callers).toBeFunction()
})
