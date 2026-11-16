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
 * next save to try again.
 */
export const uploadEmbeddedImages = async (
  html: string,
  upload: (file: File) => Promise<{ file_url: string }>,
) => {
  const fileUrls = new Map<string, string>()
  for (const url of new Set(dataUrlsIn(html))) {
    try {
      const file = await fileOf(url)
      if (file) fileUrls.set(url, (await upload(file)).file_url)
    } catch {
      // Left as a data URL; the next save tries again.
    }
  }
  return {
    uploaded: fileUrls.size > 0,
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

const dataUrlsIn = (html: string) => {
  if (!html.includes('data:image/')) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const urls: string[] = []
  for (const image of doc.querySelectorAll('img[src^="data:image/"]')) {
    const src = image.getAttribute('src')
    if (src) urls.push(src)
  }
  return urls
}

const pointAtFiles = (html: string, fileUrls: Map<string, string>) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let changed = false
  for (const image of doc.querySelectorAll('img[src^="data:image/"]')) {
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
 * `;charset=`) and all. Nothing for one that holds something other than an image.
 */
const fileOf = async (url: string) => {
  const response = await fetch(url)
  const type = response.headers.get('content-type')?.split(';')[0].trim() ?? ''
  if (!type.startsWith('image/')) return
  const extension = type.split('/')[1].split('+')[0]
  return new File([await response.arrayBuffer()], `image.${extension}`, { type })
}
