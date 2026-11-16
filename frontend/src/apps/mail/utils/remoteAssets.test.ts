import { describe, expect, it } from 'vitest'

import { analyzeRemoteAssets, blockRemoteAssets } from '@/apps/mail/utils/remoteAssets'

const stylesheets = (html: string) =>
  [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('style')]
    .map((style) => style.textContent)
    .join('\n')

describe('remote content in a message’s CSS', () => {
  it('withholds a stylesheet imported from another host, and still offers to show it', () => {
    const html = `
      <style>
        @import "https://fonts.example.com/display.css";
        @import url(https://fonts.example.com/text.css);
        @import url('//cdn.example.com/icons.css');
        .logo { background: url(cid:logo@mail); font-family: "Helvetica Neue", sans-serif; }
      </style>
      <p>Hello</p>`

    const css = stylesheets(blockRemoteAssets(html))
    expect(css).not.toContain('example.com')
    expect(css).toContain('url(cid:logo@mail)')
    expect(css).toContain('"Helvetica Neue"')
    expect(analyzeRemoteAssets(html).hasRemote).toBe(true)
  })

  it('withholds a url() written with CSS escapes, and still offers to show it', () => {
    const html = `
      <style>
        /* the sender's own note */
        .a { background: \\75 rl(https://tracker.example/a.gif); }
        .b { background: url(h\\74tps://tracker.example/b.gif); }
      </style>
      <div style="background-image: u\\72l('https://tracker.example/c.gif')">Hello</div>`

    const blocked = blockRemoteAssets(html)
    expect(blocked).not.toContain('tracker')
    expect(analyzeRemoteAssets(html).hasRemote).toBe(true)
  })

  it('keeps a rule that only compares a link against an address, with nothing to offer', () => {
    const html = `
      <style>
        a[href^="https://"] { color: #0969da; }
        a[href*='//example.com/unsubscribe'] { color: #57606a; }
      </style>
      <p><a href="https://example.com">Read online</a></p>`

    const css = stylesheets(blockRemoteAssets(html))
    expect(css).toContain('a[href^="https://"] { color: #0969da; }')
    expect(css).toContain("a[href*='//example.com/unsubscribe'] { color: #57606a; }")
    expect(analyzeRemoteAssets(html).hasRemote).toBe(false)
  })

  it('still withholds an import that follows an attribute selector', () => {
    const html = `
      <style>
        a[href^="https://"] { color: #0969da; }
        @import "https://fonts.example.com/display.css";
      </style>`

    const css = stylesheets(blockRemoteAssets(html))
    expect(css).not.toContain('fonts.example.com')
    expect(css).toContain('a[href^="https://"]')
    expect(analyzeRemoteAssets(html).hasRemote).toBe(true)
  })
})
