import { describe, expect, it } from 'vitest'

import { nodeIcon } from '../internal/icons'
import { offeredTypes, typeNouns, typeQuery, typesFromQuery, typeSummary } from './typeFilter'

const everywhere = offeredTypes({ folders: true })
const values = (raw: unknown, offered = everywhere) =>
  typesFromQuery(raw, offered).map((option) => option.value)

describe('type filter', () => {
  it('offers every listing type, and Recent offers no folders', () => {
    expect(everywhere.map((option) => option.label)).toEqual([
      'Folders',
      'Documents',
      'Spreadsheets',
      'Presentations',
      'PDFs',
      'Images',
      'Videos',
      'Audio',
    ])
    expect(offeredTypes({ folders: false }).map((option) => option.value)).not.toContain('folder')
  })

  it('draws each type with the icon its rows have in the listing', () => {
    const icons = Object.fromEntries(
      everywhere.map((option) => [option.value, nodeIcon(option.sample)]),
    )
    expect(icons).toEqual({
      folder: 'lucide-folder',
      document: 'lucide-file-text',
      spreadsheet: 'lucide-table',
      presentation: 'lucide-presentation',
      pdf: 'lucide-file',
      image: 'lucide-image',
      video: 'lucide-video',
      audio: 'lucide-audio-lines',
    })
  })

  it('reads the offered types from a comma-separated query, in menu order', () => {
    expect(values('image')).toEqual(['image'])
    expect(values('image,pdf,image')).toEqual(['pdf', 'image'])
    expect(values(undefined)).toEqual([])
    expect(values(['image', 'pdf'])).toEqual([])
    // An unknown value, such as an old Recent link's document type key, is left out.
    expect(values('writer,pdf,images')).toEqual(['pdf'])
    expect(values('folder,video', offeredTypes({ folders: false }))).toEqual(['video'])
  })

  it('writes the query back in the same form, so a cleaned query reads the same', () => {
    expect(typeQuery(typesFromQuery('image,pdf,writer', everywhere))).toBe('pdf,image')
    expect(typeQuery([])).toBeUndefined()
  })

  it('names one type, counts several, and joins their nouns for a sentence', () => {
    const [pdf, image, video] = typesFromQuery('pdf,image,video', everywhere)
    expect(typeSummary([])).toBeNull()
    expect(typeSummary([pdf])).toBe('PDFs')
    expect(typeSummary([pdf, image])).toBe('2 types')
    expect(typeNouns([pdf])).toBe('PDFs')
    expect(typeNouns([pdf, image])).toBe('PDFs or images')
    expect(typeNouns([pdf, image, video])).toBe('PDFs, images or videos')
  })
})
