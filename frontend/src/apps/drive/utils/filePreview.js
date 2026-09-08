// Independent of `Drive Disk Settings.preview_size`, which is the backend's
// generated-thumbnail pixel dimension (drive-layer-spec.md §9.2). This guards
// against inlining a very large file's full content in the browser; it has
// never been about preview resolution.
export const MAX_INLINE_PREVIEW_MB = 100

const MIME_TYPE_OVERRIDES = {
  'text/csv': 'Text',
}

export function previewFileType(entity) {
  return MIME_TYPE_OVERRIDES[entity.mime_type] || entity.file_type
}

export function previewUnavailableReason(entity, supportedTypes) {
  if (!supportedTypes.includes(previewFileType(entity)))
    return 'Previews are not supported for this file type. Would you like to download it instead?'
  if (entity.file_size > MAX_INLINE_PREVIEW_MB * 1024 * 1024)
    return 'This is too large to preview - would you like to download instead?'
  return false
}
