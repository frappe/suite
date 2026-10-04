import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createApp, h } from 'vue'

import type { TextLanguage } from '../../internal/previewKind'
import { TEXT_PREVIEW_LIMIT } from './textContent'
import TextPreview from './TextPreview.vue'

const SRC = '/api/suite/drive/nodes/n1/content'
const DOWNLOAD = '/api/suite/drive/nodes/n1/content?download=1'
// The editor loads its language on first use, which takes longer than
// waitFor's 1 s default on a cold module cache.
const EDITOR = { timeout: 5000 }
let unmount: (() => void) | null = null

afterEach(() => {
  unmount?.()
  unmount = null
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function serve(response: () => Promise<Response>) {
  const fetch = vi.fn(response)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function mount(props: { size: number; language?: TextLanguage; rendered?: boolean }) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () =>
      h(TextPreview, { src: SRC, download: DOWNLOAD, title: 'file', language: 'plain', ...props }),
  })
  app.mount(root)
  unmount = () => app.unmount()
  // Let the fetch, the editor's import and the render settle.
  await vi.waitFor(
    () => expect(root.textContent?.trim() || root.querySelector('.cm-editor')).toBeTruthy(),
    EDITOR,
  )
  return root
}

describe('text preview', () => {
  it('offers a download instead of loading a file over the size limit', async () => {
    const fetch = serve(async () => new Response('never'))
    const root = await mount({ size: TEXT_PREVIEW_LIMIT + 1 })

    expect(root.textContent).toContain('Too large to preview')
    expect(root.querySelector('[label="Download"]')?.getAttribute('href')).toBe(DOWNLOAD)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows an HTML file as its source, without rendering it', async () => {
    const page = '<h1>Hello</h1>\n<script>window.ran = true</script>'
    serve(async () => new Response(page))
    const root = await mount({ size: page.length, language: 'html' })

    await vi.waitFor(() => expect(root.querySelector('.cm-content')).not.toBeNull(), EDITOR)
    expect(root.querySelector('.cm-content')?.textContent).toBe(
      '<h1>Hello</h1><script>window.ran = true</script>',
    )
    expect(root.querySelector('h1, script')).toBeNull()
    expect((window as { ran?: boolean }).ran).toBeUndefined()
  })

  it('shows a Markdown file rendered, or as its source', async () => {
    const text = [
      '# Plan',
      '',
      '## Goals',
      '',
      '- Ship the preview',
      '- Write tests',
      '',
      '| Step | Owner |',
      '| --- | --- |',
      '| Build | Faris |',
      '',
      '```js',
      'const answer = 42',
      '```',
    ].join('\n')
    serve(async () => new Response(text))
    const rendered = await mount({ size: text.length, language: 'markdown', rendered: true })

    expect(rendered.querySelector('h1')?.textContent).toBe('Plan')
    expect(rendered.querySelector('h2')?.textContent).toBe('Goals')
    expect([...rendered.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Ship the preview',
      'Write tests',
    ])
    expect(rendered.querySelector('td')?.textContent).toBe('Build')
    expect(rendered.querySelector('pre code')?.textContent).toBe('const answer = 42\n')
    expect(rendered.querySelector('.cm-editor')).toBeNull()

    unmount?.()
    const source = await mount({ size: text.length, language: 'markdown' })
    await vi.waitFor(() => expect(source.querySelector('.cm-content')).not.toBeNull(), EDITOR)
    expect(source.querySelector('.cm-content')?.textContent).toContain('# Plan')
    expect(source.querySelector('h1')).toBeNull()
  })

  it('renders no script, event handler or unsafe link from a Markdown file', async () => {
    const text = [
      '# Notes',
      '',
      '<script>window.ran = true</script>',
      '',
      'An image <img src=x onerror="window.ran = true"> inline.',
      '',
      '[Run](javascript:window.ran=true) and [Frappe](https://frappe.io), see [Notes](#notes)',
      '',
      '![Badge](https://img.example.com/badge.svg) ![Logout](/api/method/logout)',
    ].join('\n')
    serve(async () => new Response(text))
    const root = await mount({ size: text.length, language: 'markdown', rendered: true })

    expect(root.querySelector('h1')?.textContent).toBe('Notes')
    // Raw HTML stays text: the reader sees it, and the browser never parses it.
    expect(root.querySelector('script')).toBeNull()
    expect(root.textContent).toContain('<script>window.ran = true</script>')
    expect(root.querySelector('[onerror]')).toBeNull()
    expect((window as { ran?: boolean }).ran).toBeUndefined()

    // The `javascript:` link is left as its text. A link to another page opens
    // in a new tab, and a link to a place in the file stays in this one.
    const links = root.querySelectorAll('a')
    expect(links).toHaveLength(2)
    expect(root.querySelector('article')?.textContent).toContain('Run and Frappe')
    const [frappe, notes] = links
    expect(frappe.getAttribute('href')).toBe('https://frappe.io')
    expect(frappe.getAttribute('target')).toBe('_blank')
    expect(frappe.getAttribute('rel')).toBe('noopener noreferrer')
    expect(notes.getAttribute('href')).toBe('#notes')
    expect(notes.hasAttribute('target')).toBe(false)

    // Only an HTTPS image from another site loads, and it is not told which page asked.
    // Any other image shows its alt text.
    const images = root.querySelectorAll('img')
    expect(images).toHaveLength(1)
    expect(images[0].getAttribute('src')).toBe('https://img.example.com/badge.svg')
    expect(images[0].getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(root.querySelector('article')?.textContent).toContain('Logout')
  })

  it('scrolls to the heading a link in the file points to, as GitHub names it', async () => {
    const text = [
      '[Setup](#setup) · [Q&A](#qa) · [Second notes](#notes-1) · [Missing](#nowhere)',
      '',
      '## Setup',
      '## Notes',
      '## Q&A',
      '## Notes',
    ].join('\n')
    serve(async () => new Response(text))
    const root = await mount({ size: text.length, language: 'markdown', rendered: true })
    const scrolled: string[] = []
    // jsdom does not scroll, so the test records which heading would come into view.
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(
        `${this.tagName} ${this.textContent} ${[...this.parentElement!.children].indexOf(this)}`,
      )
    }
    onTestFinished(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    })
    const open = (label: string) => {
      const link = [...root.querySelectorAll('a')].find((anchor) => anchor.textContent === label)!
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      link.dispatchEvent(click)
      return click.defaultPrevented
    }

    // The page's address stays as it is: the jump happens inside the preview.
    expect(open('Setup')).toBe(true)
    open('Q&A')
    open('Second notes')
    open('Missing')
    await vi.waitFor(() => expect(scrolled).toEqual(['H2 Setup 1', 'H2 Q&A 3', 'H2 Notes 4']))
  })

  it('shows an empty file as an empty viewer, without fetching it', async () => {
    const fetch = serve(async () => new Response('', { status: 409 }))
    const root = await mount({ size: 0 })

    await vi.waitFor(() => expect(root.querySelector('.cm-content')).not.toBeNull(), EDITOR)
    expect(root.querySelector('.cm-content')?.textContent).toBe('')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows the fallback for bytes that are not UTF-8 text', async () => {
    serve(async () => new Response(new Uint8Array([0xff, 0xfe, 0x00, 0x41])))
    const root = await mount({ size: 4 })

    expect(root.textContent).toContain('No preview')
    expect(root.querySelector('[label="Download"]')?.getAttribute('href')).toBe(DOWNLOAD)
  })

  it('shows the fallback when the file cannot be fetched', async () => {
    serve(async () => new Response('Forbidden', { status: 403 }))
    const root = await mount({ size: 10 })

    expect(root.textContent).toContain('Could not load the preview')
    expect(root.querySelector('[label="Download"]')?.getAttribute('href')).toBe(DOWNLOAD)
  })
})
