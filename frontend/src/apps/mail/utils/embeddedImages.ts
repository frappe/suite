import type { Transaction } from '@tiptap/pm/state'

import { randomString } from '@/apps/mail/utils'

/**
 * Images still in a body as `data:` URLs, uploaded and pointed at their files on the way out.
 *
 * The editor uploads an image dropped or pasted on its own, but some come in as data URLs and stay
 * that way: an image inside pasted HTML, one in a forwarded mail, one left in an older draft. Sent
 * like that the image travels as base64 inside the HTML: megabytes many clients strip, and not an
 * attachment the recipient can save. Uploaded here it becomes a file with a `data-cid`, which the
 * send path turns into an inline attachment like any other (processInlineImages).
 *
 * The uploads take a while and the body goes on being edited meanwhile, so this uploads from the
 * body as it was and hands back the change to make, to whatever the body is once they are done:
 * as HTML, or in an editor's document. An upload that fails leaves its image as it is, for the
 * next save to try again, and says why in `failures`.
 */
export const uploadEmbeddedImages = async (
  html: string,
  upload: (file: File) => Promise<{ file_url: string }>,
) => {
  const fileUrls = new Map<string, string>()
  const failures = new Map<string, unknown>()
  for (const url of new Set(embeddedImagesIn(html).map((image) => image.url))) {
    try {
      const file = fileOf(url)
      if (file) fileUrls.set(url, (await upload(file)).file_url)
      else failures.set(url, undefined)
    } catch (error) {
      // Left as a data URL; the next save tries again.
      failures.set(url, error)
    }
  }
  return {
    uploaded: fileUrls.size > 0,
    /** Why each image left as a data URL wasn't uploaded, by its URL: the upload's error, if any. */
    failures,
    /** `current` with each uploaded image pointed at its file. */
    inHtml: (current: string) => (fileUrls.size ? pointAtFiles(current, fileUrls) : current),
    /**
     * The same change, made by `tr` to an editor's document node by node. Setting the editor's
     * content instead would throw the caret to the end, and lose an image the editor is still
     * uploading: that one has no `src` yet, and an image without one doesn't parse back in.
     */
    inDocument: (tr: Transaction) => {
      tr.doc.descendants((node, pos) => {
        const fileUrl = node.type.name === 'image' && fileUrls.get(node.attrs.src)
        if (!fileUrl) return
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          src: fileUrl,
          'data-cid': node.attrs['data-cid'] || randomString(10),
        })
      })
      return tr.docChanged
    },
  }
}

/**
 * The images in `html` still held as data URLs, in the order they show, each with what a person
 * would know it by: the name its data URL carries, else its alt text, and its place among the images.
 */
export const embeddedImagesIn = (html: string) => {
  if (!/data:/i.test(html)) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return [...doc.querySelectorAll('img')].flatMap((image, index) => {
    const url = image.getAttribute('src') ?? ''
    if (!/^data:/i.test(url.trim())) return []
    const name = nameIn(url) || image.getAttribute('alt')?.trim() || ''
    return [{ url, name, position: index + 1 }]
  })
}

/** The `name` parameter of a data URL (`data:image/png;name=photo.png;base64,…`), if it has one. */
const nameIn = (url: string) => {
  const parameters = url.slice(0, url.indexOf(',')).split(';').slice(1)
  const name = parameters.find((parameter) => parameter.startsWith('name='))?.slice(5)
  if (!name) return ''
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

const pointAtFiles = (html: string, fileUrls: Map<string, string>) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let changed = false
  for (const image of doc.querySelectorAll('img')) {
    const fileUrl = fileUrls.get(image.getAttribute('src') ?? '')
    if (!fileUrl) continue
    image.setAttribute('src', fileUrl)
    if (!image.getAttribute('data-cid')) image.setAttribute('data-cid', randomString(10))
    changed = true
  }
  return changed ? doc.body.innerHTML : html
}

/**
 * The image a data URL holds, decoded the way the browser reads one, parameters (`;name=`,
 * `;charset=`) and all. Nothing for one that holds something other than an image, or that doesn't
 * decode.
 */
const fileOf = (url: string) => {
  const match = /^data:([^,]*),(.*)$/is.exec(url.trim().split('#')[0])
  if (!match) return
  const header = match[1].trim()
  const base64 = /;\s*base64$/i.test(header)
  const type = header.split(';')[0].trim().toLowerCase()
  if (!type.startsWith('image/')) return
  const bytes = base64 ? base64Decoded(percentDecoded(match[2])) : percentDecoded(match[2])
  if (!bytes) return
  const extension = type.split('/')[1].split('+')[0]
  return new File([bytes], `image.${extension}`, { type })
}

/** The bytes of `text` with each `%XX` turned into its byte. */
const percentDecoded = (text: string) => {
  const encoded = new TextEncoder().encode(text)
  const bytes = new Uint8Array(encoded.length)
  let length = 0
  for (let i = 0; i < encoded.length; i++) {
    const hex = encoded[i] === 0x25 ? String.fromCharCode(encoded[i + 1], encoded[i + 2]) : ''
    if (/^[0-9a-f]{2}$/i.test(hex)) {
      bytes[length++] = parseInt(hex, 16)
      i += 2
    } else bytes[length++] = encoded[i]
  }
  return bytes.subarray(0, length)
}

/** The bytes base64 text stands for, spaces and missing padding allowed. Nothing if it isn't base64. */
const base64Decoded = (text: Uint8Array<ArrayBuffer>) => {
  try {
    const decoded = atob(new TextDecoder('latin1').decode(text))
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  } catch {
    return
  }
}
