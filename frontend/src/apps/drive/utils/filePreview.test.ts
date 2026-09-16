import { describe, expect, it } from 'vitest'

import { MAX_INLINE_PREVIEW_MB, previewFileType, previewUnavailableReason } from './filePreview'

const SUPPORTED_TYPES = ['PDF', 'Image', 'Video', 'Audio', 'Text']

describe('previewFileType', () => {
  it('reads the file type straight off the entity', () => {
    expect(previewFileType({ file_type: 'Image', mime_type: 'image/png' })).toBe('Image')
  })

  it('overrides text/csv to Text regardless of file_type', () => {
    expect(previewFileType({ file_type: 'Spreadsheet', mime_type: 'text/csv' })).toBe('Text')
  })
})

describe('previewUnavailableReason', () => {
  it('admits a small, supported file', () => {
    const entity = { file_type: 'Image', mime_type: 'image/png', file_size: 1024 }
    expect(previewUnavailableReason(entity, SUPPORTED_TYPES)).toBe(false)
  })

  it('refuses an unsupported file type before looking at size', () => {
    const entity = { file_type: 'Archive', mime_type: 'application/zip', file_size: 1 }
    expect(previewUnavailableReason(entity, SUPPORTED_TYPES)).toMatch(/not supported/)
  })

  it('refuses a file over the independent inline-preview size cap', () => {
    const entity = {
      file_type: 'Video',
      mime_type: 'video/mp4',
      file_size: (MAX_INLINE_PREVIEW_MB + 1) * 1024 * 1024,
    }
    expect(previewUnavailableReason(entity, SUPPORTED_TYPES)).toMatch(/too large/)
  })

  it('admits a file exactly at the cap', () => {
    const entity = {
      file_type: 'Video',
      mime_type: 'video/mp4',
      file_size: MAX_INLINE_PREVIEW_MB * 1024 * 1024,
    }
    expect(previewUnavailableReason(entity, SUPPORTED_TYPES)).toBe(false)
  })

  it('does not treat a 512 px backend preview_size as a 512 MiB size cap', () => {
    // The regression this guards against: `preview_size` (pixels, default
    // 512) must never be read into this MB comparison.
    const entity = {
      file_type: 'Video',
      mime_type: 'video/mp4',
      file_size: 200 * 1024 * 1024,
    }
    expect(previewUnavailableReason(entity, SUPPORTED_TYPES)).toMatch(/too large/)
  })
})
