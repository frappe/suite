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

  // At the end of a stylesheet, the browser drops a lone backslash and closes the string there,
  // so the import still loads.
  it('withholds an import whose string ends the stylesheet with a backslash', () => {
    const html = '<style>@import "https://evil.example/x.css\\</style><p>Hello</p>'

    expect(stylesheets(blockRemoteAssets(html))).not.toContain('evil.example')
    expect(analyzeRemoteAssets(html).hasRemote).toBe(true)
  })

  // The browser drops a comment inside a bracket, quotes and all, so the rule below it still
  // fetches. A quote there must not read as a string that runs past the bracket and hides it.
  it.each([
    [
      'a double quote in a selector',
      `*:not([a=/* " */b]) { background: url(https://evil.example/x.png) } /* " ] */`,
    ],
    [
      'a single quote in a selector',
      `*:not([a=/* ' */b]) { background: url(https://evil.example/x.png) } /* ' ] */`,
    ],
    [
      'a bracket in a declaration value',
      `.a { --x: [/* " */]; background: url(https://evil.example/x.png) } /* " ] */`,
    ],
  ])('withholds what follows a comment holding %s', (_, css) => {
    const html = `<style>${css}</style><p>Hello</p>`

    expect(stylesheets(blockRemoteAssets(html))).not.toContain('evil.example')
    expect(analyzeRemoteAssets(html).hasRemote).toBe(true)
  })

  // The browser reads a backslash before CR LF as one line continuation, so the string closes at
  // the next quote; reading the escape as backslash-CR would leave the LF breaking the string, and
  // open a new one at the closing quote that hides the url() after it.
  it('withholds a url() after a string continued over a CR LF line break', () => {
    const html = `<div style='--x: [a="\\&#13;&#10;"]; background: url(https://evil.example/x.png)'>Hi</div>`

    expect(blockRemoteAssets(html)).not.toContain('evil.example')
    expect(analyzeRemoteAssets(html).hasRemote).toBe(true)
  })

  // The browser drops a url() with a quote, space, `(` or comment in it as one bad url running to
  // the next `)`, then fetches the url() after it. Ending the bad url early would leave its quote
  // or comment opening something that hides that url().
  it.each([
    ['a double quote', `.a { --x: url(a"b); background: url(https://evil.example/x.png) } /*"*/`],
    ['a single quote', `.a { --x: url(a'b); background: url(https://evil.example/x.png) } /*'*/`],
    [
      'a space and a quote',
      `.a { --x: url(a "b); background: url(https://evil.example/x.png) } /*"*/`,
    ],
    ['a comment', `.a { --x: url(a /*); background: url(https://evil.example/x.png) } /**/`],
    [
      'an opening paren',
      `.a { --x: url(a("b); background: url(https://evil.example/x.png) } /*"*/`,
    ],
    [
      'a no-break space and a quote',
      `.a { --x: url(\u00a0"b); background: url(https://evil.example/x.png) } /*"*/`,
    ],
    ['a quote, before an import', `@import url(a"b); @import "https://evil.example/x.css"; /*"*/`],
  ])('withholds what follows a bad url() holding %s', (_, css) => {
    const html = `<style>${css}</style><p>Hello</p>`

    expect(stylesheets(blockRemoteAssets(html))).not.toContain('evil.example')
    expect(analyzeRemoteAssets(html).hasRemote).toBe(true)
  })

  it('withholds what follows a bad url() in an inline style', () => {
    const html = `<div style='--x: url(a"b); background: url(https://evil.example/x.png); --y: "'>Hi</div>`

    expect(blockRemoteAssets(html)).not.toContain('evil.example')
    expect(analyzeRemoteAssets(html).hasRemote).toBe(true)
  })

  // A string broken by a newline ends just before it, and the browser reads on from there.
  it('withholds what follows a string broken by a newline', () => {
    const html = `<style>.a { --x: "b /*\n; background: url(https://evil.example/x.png) } /**/</style>`

    expect(stylesheets(blockRemoteAssets(html))).not.toContain('evil.example')
    expect(analyzeRemoteAssets(html).hasRemote).toBe(true)
  })

  // Where `url(` ends a longer name, the browser reads a plain function, hash or at-keyword, and a
  // quote after it opens a string. Taking it for a url() would read past that string's `)`.
  it.each([
    ['a function', `xurl(`],
    ['a hash', `#url(`],
    ['an escaped letter', `\\78 url(`],
  ])('withholds what follows `url(` at the end of %s', (_, name) => {
    const html = `<style>.a { --x: ${name}a"b)/*")); background: url(https://evil.example/x.png) } /*"*/</style>`

    expect(stylesheets(blockRemoteAssets(html))).not.toContain('evil.example')
    expect(analyzeRemoteAssets(html).hasRemote).toBe(true)
  })
})
