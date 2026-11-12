import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PictureFetch } from '@/apps/writer/utils/docxexporter'

import { downloadDocx, toMarkdown } from './exports'

/** What the DOCX converter was last asked to build, without building it. */
const docxCalls: { filename: string; fetchPicture: PictureFetch | undefined }[] = []
vi.mock('@/apps/writer/utils/docxexporter', () => ({
  downloadDocxFromHtml: async (
    _html: string,
    filename: string,
    _settings: unknown,
    fetchPicture?: PictureFetch,
  ) => {
    docxCalls.push({ filename, fetchPicture })
  },
}))

afterEach(() => {
  docxCalls.length = 0
  vi.unstubAllGlobals()
})

describe('Markdown export', () => {
  it('saves a stored picture beside the Markdown and links it by a relative path', async () => {
    const requested: string[] = []
    const fetchMedia = async (url: string) => {
      requested.push(url)
      return new Response(new Blob(['png bytes'], { type: 'image/png' }))
    }

    const { markdown, media } = await toMarkdown(
      '<h1>Plan</h1><p>Some <strong>bold</strong> text.</p><img src="/api/method/suite.writer.api.embed.get?id=pic-1">',
      fetchMedia,
    )

    expect(markdown).toBe('# Plan\n\nSome **bold** text.\n\n![](images/1.png)')
    expect(requested).toEqual(['/api/method/suite.writer.api.embed.get?id=pic-1'])
    expect(media.map(({ path }) => path)).toEqual(['images/1.png'])
  })

  it('keeps the stored link of a picture it may not read', async () => {
    const refused = async () => new Response('Not found', { status: 404 })
    const src = '/api/method/suite.writer.api.embed.get?id=pic-2'

    const { markdown, media } = await toMarkdown(`<img src="${src}">`, refused)

    expect(markdown).toBe(`![](${src})`)
    expect(media).toEqual([])
  })

  it('writes a table as a GitHub-flavoured table with the first row as its heading', async () => {
    const noMedia = async () => new Response(null, { status: 404 })
    // The editor's own table markup: one paragraph per cell, a header row first.
    const html =
      '<p>Owners</p>' +
      '<table><tbody>' +
      '<tr><th><p>Owner</p></th><th colspan="2"><p>Dates</p></th></tr>' +
      '<tr><td><p>Aanya</p></td><td><p>12 Oct</p></td><td><p>Tue <strong>|</strong> late</p></td></tr>' +
      '<tr><td><p>Ravi</p><p>on leave</p></td><td><p></p></td><td><p>13 Oct</p></td></tr>' +
      '</tbody></table>' +
      '<p>After</p>'

    const { markdown } = await toMarkdown(html, noMedia)

    expect(markdown).toBe(
      [
        'Owners',
        '',
        '| Owner | Dates |  |',
        '| --- | --- | --- |',
        '| Aanya | 12 Oct | Tue **\\|** late |',
        '| Ravi<br>on leave |  | 13 Oct |',
        '',
        'After',
      ].join('\n'),
    )
  })
})

describe('DOCX export', () => {
  it('fetches stored pictures with the session credentials and other pictures as the browser would', async () => {
    const credentialed: string[] = []
    const fetchMedia = async (url: string) => {
      credentialed.push(url)
      return new Response(new Blob(['png'], { type: 'image/png' }))
    }
    const plain = vi.fn(async (url: string) => new Response(url))
    vi.stubGlobal('fetch', plain)

    await downloadDocx('<p>Plan</p>', 'Launch: plan', { font_size: 15 }, fetchMedia)

    expect(docxCalls.map(({ filename }) => filename)).toEqual(['Launch plan.docx'])
    const fetchPicture = docxCalls[0]!.fetchPicture!
    const stored = document.createElement('img')
    stored.setAttribute('src', '/api/method/suite.writer.api.embed.get?id=pic-9')
    const elsewhere = document.createElement('img')
    elsewhere.setAttribute('src', 'https://example.com/logo.png')

    await fetchPicture(stored)
    await fetchPicture(elsewhere)

    expect(credentialed).toEqual(['/api/method/suite.writer.api.embed.get?id=pic-9'])
    expect(plain).toHaveBeenCalledTimes(1)
    expect(plain).toHaveBeenCalledWith('https://example.com/logo.png')
  })
})
