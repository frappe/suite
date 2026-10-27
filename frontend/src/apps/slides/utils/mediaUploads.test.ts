import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

// A deck names its pictures by media node id: Build rewrote migrated decks (spec
// §14.7) and every upload stores one (T3-21). The renderer shows it through the
// deck session's media handle, the signed url `GET /nodes/<deck>/media` answers
// (§6.8). A legacy `/private/files/` url keeps the url it was given.

vi.mock('@/apps/slides/stores/presentation', () => ({
  presentationId: ref('p1'),
  presentationDoc: ref({ owner: 'u1' }),
}))
vi.mock('@/apps/slides/stores/slide', () => ({ currentSlide: ref(null) }))
vi.mock('@/apps/slides/stores/element', () => ({
  addMediaElement: vi.fn(),
  replaceMediaElement: vi.fn(),
}))
vi.mock('frappe-ui', () => ({ toast: {}, FileUploadHandler: class {} }))

const { getAttachmentUrl, mediaFileName } = await import('./mediaUploads')
const { setDocumentMedia } = await import('../stores/documentMedia')

type Status = 'loading' | 'ready' | 'refused'

const handle = (id: string, src: string | null, status: Status) => ({
  id,
  src: ref(src),
  cacheKey: ref(`drive-media:${id}`),
  status: ref(status),
  refresh: async () => {},
})

let release = () => {}
afterEach(() => release())

describe('a picture named by node id', () => {
  it('shows the url the deck session signed for that node, and follows a fresh signature', () => {
    const logo = handle('74s2fbb778', '/f/d61n3nhagn/logo.png?e=1&s=first', 'ready')
    release = setDocumentMedia((id) => (id === logo.id ? logo : handle(id, null, 'refused')))

    const shown = computed(() => getAttachmentUrl('74s2fbb778'))
    expect(shown.value).toBe('/f/d61n3nhagn/logo.png?e=1&s=first')

    logo.src.value = '/f/d61n3nhagn/logo.png?e=2&s=second'
    expect(shown.value).toBe('/f/d61n3nhagn/logo.png?e=2&s=second')
  })

  it('shows nothing while the url loads, once Drive refuses it, or without a deck session', () => {
    expect(getAttachmentUrl('74s2fbb778')).toBe('')

    release = setDocumentMedia((id) =>
      id === 'loading' ? handle(id, null, 'loading') : handle(id, '/f/old/gone.png?s=x', 'refused'),
    )
    expect(getAttachmentUrl('loading')).toBe('')
    expect(getAttachmentUrl('refused')).toBe('')

    release()
    expect(getAttachmentUrl('74s2fbb778')).toBe('')
  })
})

describe('a picture named by url', () => {
  it.each([
    ['the /f/ url a fresh upload stores', '/f/88a15bfe0b/photo.png'],
    ['a data url', 'data:image/png;base64,AAAA'],
    ['a bundled asset', '/assets/suite/slides/placeholder.png'],
  ])('keeps %s as it is', (_name, url) => {
    release = setDocumentMedia((id) => handle(id, '/f/never/used.png', 'ready'))
    expect(getAttachmentUrl(url)).toBe(url)
  })

  it('still sends a viewer through the legacy proxy for a /private/files url', () => {
    expect(getAttachmentUrl('/private/files/a.png')).toBe(
      '/api/method/suite.slides.api.file.get_media_file?src=%2Fprivate%2Ffiles%2Fa.png&presentation=p1',
    )
  })
})

describe('the file name the panel shows', () => {
  it("reads a media node's name from its signed url, and a legacy url's from the url", () => {
    const banner = handle('82gtqds5ao', '/private/files/ff9k/q3%20banner.png?e=1&s=x', 'ready')
    release = setDocumentMedia(() => banner)

    expect(mediaFileName('82gtqds5ao')).toBe('q3 banner.png')
    expect(mediaFileName('/private/files/old-logo.png')).toBe('old-logo.png')
    expect(mediaFileName(undefined)).toBe('')
  })
})
