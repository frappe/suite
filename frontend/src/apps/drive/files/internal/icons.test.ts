import { describe, expect, it } from 'vitest'

import { nodeIcon, nodeIconTint } from './icons'

const unsniffed = 'application/octet-stream'
const file = (title: string, mime: string | null) =>
  ({ kind: 'file', title, mime, content_doctype: null }) as const
const document = (contentDoctype: string) =>
  ({ kind: 'document', title: 'Untitled', mime: null, content_doctype: contentDoctype }) as const

describe('file type icons', () => {
  it('draws and colours a node by what it is, even when the MIME type says nothing', () => {
    const drawn = (node: Parameters<typeof nodeIcon>[0]) => [nodeIcon(node), nodeIconTint(node)]

    expect(drawn({ kind: 'folder', title: 'Plans', mime: null, content_doctype: null })).toEqual([
      'file-icon-folder',
      'text-ink-gray-6',
    ])
    expect(drawn({ kind: 'link', title: 'Site', mime: null, content_doctype: null })).toEqual([
      'file-icon-link',
      'text-ink-gray-6',
    ])
    expect(drawn(document('Writer Document'))).toEqual(['file-icon-doc', 'text-ink-blue-6'])
    expect(drawn(document('Sheet'))).toEqual(['file-icon-sheet', 'text-ink-green-6'])
    expect(drawn(document('Spreadsheet'))).toEqual(['file-icon-sheet', 'text-ink-green-6'])
    expect(drawn(document('Presentation'))).toEqual(['file-icon-slides', 'text-ink-orange-6'])
    expect(drawn(document('Something New'))).toEqual(['file-icon-file', 'text-ink-gray-6'])

    expect(drawn(file('plan.pdf', unsniffed))).toEqual(['file-icon-pdf', 'text-ink-red-6'])
    expect(drawn(file('photo.jpg', 'image/jpeg'))).toEqual(['file-icon-image', 'text-ink-violet-6'])
    expect(drawn(file('talk.mp4', unsniffed))).toEqual(['file-icon-video', 'text-ink-pink-6'])
    expect(drawn(file('song.mp3', 'audio/mpeg'))).toEqual(['file-icon-audio', 'text-ink-cyan-6'])
    expect(drawn(file('README.md', unsniffed))).toEqual(['file-icon-text', 'text-ink-gray-6'])
    expect(drawn(file('rows.csv', 'text/plain'))).toEqual(['file-icon-csv', 'text-ink-gray-6'])
    expect(drawn(file('rows.tsv', unsniffed))).toEqual(['file-icon-csv', 'text-ink-gray-6'])
    expect(drawn(file('main.ts', unsniffed))).toEqual(['file-icon-code', 'text-ink-gray-6'])
    expect(drawn(file('photos.zip', 'application/zip'))).toEqual([
      'file-icon-archive',
      'text-ink-gray-6',
    ])
    expect(drawn(file('logs.tar.gz', 'application/x-compressed'))).toEqual([
      'file-icon-archive',
      'text-ink-gray-6',
    ])
    expect(drawn(file('firmware.bin', unsniffed))).toEqual(['file-icon-file', 'text-ink-gray-6'])
  })
})
