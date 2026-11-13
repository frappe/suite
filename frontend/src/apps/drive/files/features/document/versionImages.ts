import { api, client } from '@/api'
import type { DocumentSession } from '@/apps/drive'

const MANAGE = 50

/** An image a version shows that the file no longer has. */
export interface MissingImage {
  id: string
  name: string
  isBinned: boolean
  /** Whether this person may take it out of the bin; only a binned image can be */
  canRestore: boolean
}

/** An image a version shows, by its media node id, with its alt text. */
export interface VersionImage {
  id: string
  alt: string
}

/** The version's images that are in the bin or deleted, and whether this person may bring each back. */
export async function missingImages(
  session: DocumentSession,
  images: VersionImage[],
): Promise<MissingImage[]> {
  if (!images.length) {
    return []
  }

  const context = session.credentials.context
  const { media } = await client.query(api.drive.nodes.media, { node: session.nodeId }, { context })
  const present = new Set(media.map((row) => row.node))
  const states = await Promise.all(
    images.flatMap((image) => (!present.has(image.id) ? [imageState(image, context)] : [])),
  )
  return states.filter((state) => state !== null)
}

async function imageState(
  image: VersionImage,
  context: DocumentSession['credentials']['context'],
): Promise<MissingImage | null> {
  try {
    const node = await client.query(
      api.drive.nodes.get,
      { node: image.id, expand: 'access' },
      { context },
    )
    if (node.state !== 'Trashed') {
      return null
    }

    // Only a trash root comes out alone, and the weekly sweep bins as an admin, so MANAGE is the rule
    const canRestore = node.trash_root === node.name && (node.access?.role ?? 0) >= MANAGE
    return { id: image.id, name: node.title, isBinned: true, canRestore }
  } catch (error) {
    if (!(
      error &&
      typeof error === 'object' &&
      'type' in error &&
      error.type === 'DriveNotFound'
    )) {
      throw error
    }

    return { id: image.id, name: image.alt, isBinned: false, canRestore: false }
  }
}

/** Takes the images out of the bin; one that can't come out stays and shows broken. */
export async function restoreImages(
  session: DocumentSession,
  images: MissingImage[],
): Promise<void> {
  const nodes = images.flatMap((image) => (image.canRestore ? [image.id] : []))
  if (!nodes.length) {
    return
  }

  await client.mutation(
    api.drive.nodes.batch,
    { nodes, patch: { state: 'Active' } },
    { context: session.credentials.context },
  )
  // The preview marked them refused, and the session reads its media together
  await session.media(nodes[0]).refresh()
}

/** What the restore dialog says about the version's missing images. */
export function imagesNotice(images: MissingImage[]): string {
  const back = images.flatMap((image) => (image.canRestore ? [nameOf(image)] : []))
  const broken = images.flatMap((image) => (!image.canRestore ? [brokenName(image)] : []))
  const lines = []
  if (back.length) {
    lines.push('These images are in the bin and come back with it: ' + back.join(', ') + '.')
  }

  if (broken.length) {
    lines.push('These images will show broken: ' + broken.join(', ') + '.')
  }

  return lines.join(' ')
}

function nameOf(image: MissingImage): string {
  return image.name || 'An image with no name'
}

function brokenName(image: MissingImage): string {
  if (image.isBinned) {
    return nameOf(image) + " (in the bin, and you can't restore it)"
  }

  return nameOf(image) + ' (deleted)'
}
