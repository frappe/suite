import { describe, expect, it } from 'vitest'

import { previewKind } from './previewKind'

const file = (title: string, mime: string | null, hasPreview = false) => previewKind({ title, mime, hasPreview })

describe('preview kind', () => {
  it('shows an HTML page as source text, never as a page', () => {
    expect(file('index.html', 'text/html')).toEqual({ kind: 'text', language: 'html' })
    expect(file('legacy.HTM', 'text/html')).toEqual({ kind: 'text', language: 'html' })
    // A renamed page is still not rendered.
    expect(file('page', 'text/html')).toEqual({ kind: 'text', language: 'html' })
  })

  it('shows text formats Drive cannot sniff as text, by their extension', () => {
    // Drive records `application/octet-stream` for text with no signature.
    const unsniffed = 'application/octet-stream'
    expect(file('README.md', unsniffed)).toEqual({ kind: 'text', language: 'markdown' })
    expect(file('notes.markdown', unsniffed)).toEqual({ kind: 'text', language: 'markdown' })
    expect(file('data.json', unsniffed)).toEqual({ kind: 'text', language: 'json' })
    expect(file('main.ts', unsniffed)).toEqual({ kind: 'text', language: 'typescript' })
    expect(file('script.py', unsniffed)).toEqual({ kind: 'text', language: 'python' })
    expect(file('query.sql', unsniffed)).toEqual({ kind: 'text', language: 'sql' })
    expect(file('theme.scss', unsniffed)).toEqual({ kind: 'text', language: 'scss' })
    expect(file('config.yml', unsniffed)).toEqual({ kind: 'text', language: 'yaml' })
    expect(file('rows.csv', unsniffed)).toEqual({ kind: 'text', language: 'plain' })
    expect(file('todo.txt', null)).toEqual({ kind: 'text', language: 'plain' })
  })

  it('shows any other text type as plain text', () => {
    expect(file('notes', 'text/plain')).toEqual({ kind: 'text', language: 'plain' })
  })

  it('keeps media and PDFs in the browser viewers', () => {
    expect(file('photo.png', 'image/png')).toEqual({ kind: 'image' })
    expect(file('logo.svg', 'image/svg+xml')).toEqual({ kind: 'image' })
    expect(file('talk.mp4', 'video/mp4')).toEqual({ kind: 'video' })
    expect(file('song.mp3', 'audio/mpeg')).toEqual({ kind: 'audio' })
    expect(file('plan.pdf', 'application/pdf')).toEqual({ kind: 'pdf' })
  })

  it("shows other files' preview image, or nothing", () => {
    expect(file('deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', true)).toEqual({ kind: 'image' })
    expect(file('archive.zip', 'application/zip')).toEqual({ kind: 'none' })
    expect(file('blob.constructor', 'application/octet-stream')).toEqual({ kind: 'none' })
  })
})
