import { fileTypeIcon, fileTypeTint, type FileType } from '@/apps/drive/files/internal/icons'

// The route names a file by its mime family from the legacy mime table, and a
// content document by its content doctype. Both lists on the Statistics tab
// draw an item by its type, so a row and a file of that type look the same.
// Any other type is a plain file.
const STORAGE_FILE_TYPES: Record<string, FileType> = {
  Image: 'image',
  Video: 'video',
  Audio: 'audio',
  PDF: 'pdf',
  Archive: 'archive',
  Text: 'text',
  Code: 'code',
  'XML Data': 'code',
  Document: 'text',
  'Writer Document': 'doc',
  Spreadsheet: 'sheet',
  Sheet: 'sheet',
  Presentation: 'slides',
}

function storageFileType(type: string): FileType {
  return STORAGE_FILE_TYPES[type] ?? 'file'
}

export function storageTypeIcon(type: string): string {
  return fileTypeIcon(storageFileType(type))
}

export function storageTypeTint(type: string): string {
  return fileTypeTint(storageFileType(type))
}
