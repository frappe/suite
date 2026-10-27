import { describe, expect, it, vi } from 'vitest'

import { client } from '@/api'
import { TransportError } from '@/platform/transport'

import {
  createDocument,
  hasDefaultDocumentTitle,
  nodeContentUrl,
  openAsSpreadsheet,
  opensAsSpreadsheet,
} from './nodes'

vi.mock('@/api', () => ({
  api: { drive: { nodes: { createDocument: 'drive.nodes.createDocument' } } },
  client: { mutation: vi.fn() },
}))
vi.mock('@/platform/feedback', () => ({ reportMutationError: vi.fn() }))

describe('new document', () => {
  const mutation = vi.mocked(client.mutation)

  it('takes the free title Drive names when the default one is taken', async () => {
    mutation.mockReset()
    mutation
      .mockRejectedValueOnce(
        new TransportError({
          type: 'DriveConflict',
          status: 409,
          message: 'taken',
          free_title: 'Untitled spreadsheet (2)',
        }),
      )
      .mockResolvedValueOnce({ name: 'n2', title: 'Untitled spreadsheet (2)' })
    const node = await createDocument({ parent_node: 'home', content_doctype: 'Sheet' })
    expect(node).toEqual({ name: 'n2', title: 'Untitled spreadsheet (2)' })
    const sent = mutation.mock.calls.map(([, input, options]) => [
      (input as { title: string }).title,
      options,
    ])
    expect(sent).toEqual([
      ['Untitled spreadsheet', { silent: true }],
      ['Untitled spreadsheet (2)', { silent: false }],
    ])
  })

  it('reports and rethrows any other refusal', async () => {
    mutation.mockReset()
    const refusal = new TransportError({
      type: 'DrivePermission',
      status: 403,
      message: 'No access',
    })
    mutation.mockRejectedValueOnce(refusal)
    await expect(createDocument({ parent_node: 'home', content_doctype: 'Sheet' })).rejects.toBe(
      refusal,
    )
    const { reportMutationError } = await import('@/platform/feedback')
    await vi.waitFor(() => expect(reportMutationError).toHaveBeenCalledWith(refusal))
    expect(mutation).toHaveBeenCalledTimes(1)
  })
})

describe('opening an uploaded workbook as a spreadsheet', () => {
  const mutation = vi.mocked(client.mutation)

  it('is offered for an .xlsx or .csv file only', () => {
    expect(opensAsSpreadsheet({ kind: 'file', title: 'Q4 Budget.XLSX' })).toBe(true)
    expect(opensAsSpreadsheet({ kind: 'file', title: 'export.csv' })).toBe(true)
    expect(opensAsSpreadsheet({ kind: 'file', title: 'notes.txt' })).toBe(false)
    expect(opensAsSpreadsheet({ kind: 'document', title: 'Budget.xlsx' })).toBe(false)
  })

  it('creates a sheet beside the file from its contents, named after it', async () => {
    mutation.mockReset()
    mutation.mockResolvedValueOnce({ name: 's1', title: 'Q4 Budget' })
    await openAsSpreadsheet({ name: 'f1', title: 'Q4 Budget.xlsx', parent_node: 'folder' })
    expect(mutation.mock.calls[0]?.[1]).toEqual({
      kind: 'document',
      parent_node: 'folder',
      content_doctype: 'Sheet',
      title: 'Q4 Budget',
      from_node: 'f1',
    })
  })
})

describe('default document title', () => {
  it('is recognised on the title Drive gives a new Writer document, and only until it is renamed', async () => {
    expect(hasDefaultDocumentTitle('Untitled document')).toBe(true)
    expect(hasDefaultDocumentTitle('Quarterly plan')).toBe(false)
  })
})

describe('content URL', () => {
  it('opens a file in place by default and asks for a save only when told to', () => {
    expect(nodeContentUrl('a/b')).toBe('/api/suite/drive/nodes/a%2Fb/content')
    expect(nodeContentUrl('n1', { download: true, revision: 2 })).toBe(
      '/api/suite/drive/nodes/n1/content?download=1&v=2',
    )
  })
})
