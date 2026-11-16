import { inject } from 'vue'

import { getAttachmentUrl } from '@/apps/slides/utils/mediaUploads'

type TemplateMediaUrl = (id: string) => string

/** Where a slide's media is fetched from: a template picker's own urls first, then the open presentation's. */
export function useMediaUrl() {
  const templateMediaUrl = inject<TemplateMediaUrl | null>('templateMediaUrl', null)
  return (src: string): string => templateMediaUrl?.(src) || getAttachmentUrl(src)
}
