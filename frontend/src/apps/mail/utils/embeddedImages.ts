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
 * body as it was and hands back the change to make, for whatever the body is once they are done.
 * An upload that fails leaves its image as it is, for the next save to try again.
 */
export const uploadEmbeddedImages = async (
  html: string,
  upload: (file: File) => Promise<{ file_url: string }>,
): Promise<(current: string) => string> => {
  const fileUrls = new Map<string, string>()
  for (const url of new Set(dataUrlsIn(html))) {
    const file = fileOf(url)
    if (!file) continue
    try {
      fileUrls.set(url, (await upload(file)).file_url)
    } catch {
      // Left as a data URL; the next save tries again.
    }
  }
  return (current) => (fileUrls.size ? pointAtFiles(current, fileUrls) : current)
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

/** The file a data URL holds, or nothing for one that isn't well formed. */
const fileOf = (url: string): File | undefined => {
  const match = /^data:(image\/[\w.+-]+)?(;base64)?,(.*)$/s.exec(url)
  if (!match) return
  const type = match[1] ?? 'image/png'
  let bytes: Uint8Array<ArrayBuffer>
  try {
    const data = match[2] ? atob(match[3]) : decodeURIComponent(match[3])
    bytes = Uint8Array.from(data, (c) => c.charCodeAt(0))
  } catch {
    return
  }
  const extension = type.split('/')[1].split('+')[0]
  return new File([bytes], `image.${extension}`, { type })
}
