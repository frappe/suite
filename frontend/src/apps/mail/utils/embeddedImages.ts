import { randomString } from '@/apps/mail/utils'

/**
 * Images still in a body as `data:` URLs, uploaded and pointed at their files on the way out.
 *
 * The editor holds a pasted or dropped image as a data URL until its upload replaces it, and an
 * editor reset while the upload ran (suite#51) left the data URL there for good. Sent that way the
 * image travels as base64 inside the HTML: megabytes many clients strip, and not an attachment the
 * recipient can save. Uploaded here it becomes a file with a `data-cid`, which the send path turns
 * into an inline attachment like any other (processInlineImages).
 */
export const uploadEmbeddedImages = async (
  html: string,
  upload: (file: File) => Promise<{ file_url: string }>,
): Promise<string> => {
  if (!html.includes('data:image/')) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const images = [...doc.querySelectorAll<HTMLImageElement>('img[src^="data:image/"]')]
  if (!images.length) return html
  for (const image of images) {
    const file = fileOf(image.getAttribute('src')!)
    if (!file) continue
    const { file_url } = await upload(file)
    image.setAttribute('src', file_url)
    if (!image.getAttribute('data-cid')) image.setAttribute('data-cid', randomString(10))
  }
  return doc.body.innerHTML
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
