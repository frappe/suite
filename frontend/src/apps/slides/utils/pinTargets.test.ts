import { describe, expect, it } from 'vitest'

import { collectMediaSources, entryAssets, startupUrls } from '@/apps/slides/utils/pinTargets'

describe('collectMediaSources', () => {
  it('walks image src and poster and video poster with the slide index, never a video body', () => {
    const slides = [
      { elements: [{ type: 'text' }, { type: 'image', src: '/files/a.png' }] },
      { elements: [{ type: 'video', src: '/files/b.mp4', poster: '/files/b.png' }] },
      { elements: [{ type: 'image', src: '/files/c.gif', poster: '/files/c.png' }] },
    ]
    expect(collectMediaSources(slides)).toEqual([
      { slideIndex: 0, src: '/files/a.png' },
      { slideIndex: 1, src: '/files/b.png' },
      { slideIndex: 2, src: '/files/c.gif' },
      { slideIndex: 2, src: '/files/c.png' },
    ])
  })

  it('dedupes a url used on several slides, keeping its first slide', () => {
    const slides = [
      { elements: [{ type: 'image', src: '/files/a.png' }] },
      { elements: [{ type: 'image', src: '/files/a.png' }] },
    ]
    expect(collectMediaSources(slides)).toEqual([{ slideIndex: 0, src: '/files/a.png' }])
  })

  it('skips elements without a url and slides without elements', () => {
    const slides = [{}, { elements: [{ type: 'image' }, { type: 'shape', src: '/files/x.png' }] }]
    expect(collectMediaSources(slides)).toEqual([])
  })
})

// the urls a /d/<node> page requested to start on 8026 (DESIGN-slides-offline §3)
describe('startupUrls', () => {
  const PRESENTATION = '/api/method/suite.slides.doctype.presentation.presentation'
  const opening = [
    '/api/suite/drive/nodes/n1?expand=access%2Cpreview%2Cbreadcrumbs',
    '/api/suite/drive/nodes/n1/media',
  ]

  // the account, preferences and translations are the user's, not the presentation's
  it('lists the presentation read and the drive reads the page starts with', () => {
    expect(startupUrls('n1', 'p1', { readonly: false, composite: false })).toEqual([
      `${PRESENTATION}.get_public_presentation?name=p1`,
      ...opening,
    ])
  })

  it('adds the composite read for a read-only composite', () => {
    expect(startupUrls('n1', 'p1', { readonly: true, composite: true })).toEqual([
      `${PRESENTATION}.get_public_presentation?name=p1`,
      `${PRESENTATION}.get_composite_presentation?name=p1`,
      ...opening,
    ])
  })
})

describe('entryAssets', () => {
  it("reads the shell's entry script, its preloads and its stylesheets, same origin only", () => {
    const html = `<!doctype html><html><head>
      <script type="module" crossorigin src="/assets/suite/frontend/assets/index-a1.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/suite/frontend/assets/vendor-b2.js">
      <link rel="stylesheet" crossorigin href="/assets/suite/frontend/assets/index-c3.css">
      <link rel="stylesheet" href="https://fonts.example.com/inter.css">
      <link rel="icon" href="/assets/suite/frontend/favicon.png">
      <script>window.boot = {}</script>
    </head><body><div id="app"></div></body></html>`

    expect(entryAssets(html)).toEqual([
      '/assets/suite/frontend/assets/index-a1.js',
      '/assets/suite/frontend/assets/vendor-b2.js',
      '/assets/suite/frontend/assets/index-c3.css',
    ])
  })
})
