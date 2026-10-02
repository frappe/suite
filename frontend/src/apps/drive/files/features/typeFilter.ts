import type { DriveListingType, DriveNode } from '@/apps/drive/client/types'

type IconNode = Pick<DriveNode, 'kind' | 'title' | 'mime' | 'content_doctype'>

export interface TypeFilterOption {
  value: DriveListingType
  /** The menu label, such as "Images". */
  label: string
  /** How a sentence names these items, such as "images". */
  noun: string
  /** A node of this type, so the menu draws the icon the listing gives it. */
  sample: IconNode
}

const fileOf = (title: string, mime: string): IconNode => ({ kind: 'file', title, mime, content_doctype: null })
const documentOf = (contentDoctype: string): IconNode => ({ kind: 'document', title: contentDoctype, mime: null, content_doctype: contentDoctype })

// In menu order. The server decides which nodes each value keeps.
const OPTIONS: Record<DriveListingType, Omit<TypeFilterOption, 'value'>> = {
  folder: { label: 'Folders', noun: 'folders', sample: { kind: 'folder', title: 'Folder', mime: null, content_doctype: null } },
  document: { label: 'Documents', noun: 'documents', sample: documentOf('Writer Document') },
  spreadsheet: { label: 'Spreadsheets', noun: 'spreadsheets', sample: documentOf('Sheet') },
  presentation: { label: 'Presentations', noun: 'presentations', sample: documentOf('Presentation') },
  pdf: { label: 'PDFs', noun: 'PDFs', sample: fileOf('file.pdf', 'application/pdf') },
  image: { label: 'Images', noun: 'images', sample: fileOf('image.png', 'image/png') },
  video: { label: 'Videos', noun: 'videos', sample: fileOf('video.mp4', 'video/mp4') },
  audio: { label: 'Audio', noun: 'audio files', sample: fileOf('audio.mp3', 'audio/mpeg') },
}

const ALL = Object.entries(OPTIONS).map(([value, option]) => ({ value: value as DriveListingType, ...option }))

/** The types a listing offers. Recent hides folder rows, so it offers no Folders. */
export function offeredTypes({ folders }: { folders: boolean }): TypeFilterOption[] {
  return folders ? ALL : ALL.filter((option) => option.value !== 'folder')
}

/**
 * The offered types a `?type=` value names, in menu order. The value is a
 * comma-separated list, as the Drive API takes it. Any other value is left out.
 */
export function typesFromQuery(raw: unknown, offered: readonly TypeFilterOption[]): TypeFilterOption[] {
  if (typeof raw !== 'string') return []
  const named = new Set(raw.split(','))
  return offered.filter((option) => named.has(option.value))
}

/** The `?type=` value that names `types`, or `undefined` for none. */
export function typeQuery(types: readonly Pick<TypeFilterOption, 'value'>[]): string | undefined {
  return types.length ? types.map((option) => option.value).join(',') : undefined
}

/** What the filter's trigger says: one type by name, several by count. */
export function typeSummary(types: readonly TypeFilterOption[]): string | null {
  if (!types.length) return null
  return types.length === 1 ? types[0].label : `${types.length} types`
}

/** The chosen types as a sentence names them: "PDFs", "PDFs or images", "PDFs, images or videos". */
export function typeNouns(types: readonly TypeFilterOption[]): string {
  const nouns = types.map((option) => option.noun)
  return nouns.length > 1 ? `${nouns.slice(0, -1).join(', ')} or ${nouns.at(-1)}` : nouns.join('')
}
