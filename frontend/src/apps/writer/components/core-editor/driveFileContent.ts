import type { JSONContent } from '@tiptap/core'

import { driveNodeRoute, nodeContentUrl, type DriveNodeSummary } from '@/apps/drive'

/** A file or document picked from Drive. */
export type DriveFile = Pick<DriveNodeSummary, 'name' | 'title' | 'kind' | 'mime'>

/**
 * How a Drive file goes into a document. A picture or a video shows the file
 * itself, through Drive's content URL, so each reader loads it with their own
 * Drive access. Anything else is a link to the file, named by its title.
 */
export function driveFileContent(file: DriveFile): JSONContent {
  const src = nodeContentUrl(file.name)
  const media = file.kind === 'file' ? file.mime?.split('/')[0] : undefined
  if (media === 'image') return { type: 'image', attrs: { src, alt: file.title } }
  if (media === 'video') return { type: 'video', attrs: { src, title: file.title } }
  const href = driveNodeRoute(file).path
  return { type: 'text', text: file.title, marks: [{ type: 'link', attrs: { href } }] }
}
