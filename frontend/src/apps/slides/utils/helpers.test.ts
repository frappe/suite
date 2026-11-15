import { expect, it, vi } from 'vitest'

import { getThumbnailCardStyles } from '@/apps/slides/utils/helpers'

vi.mock('frappe-ui', () => ({ toast: {}, FileUploadHandler: class {} }))

it('gives a layout with no picture no background image, so no empty address is fetched', () => {
  expect(getThumbnailCardStyles('')).not.toHaveProperty('backgroundImage')
})

it('shows a layout picture as the card background', () => {
  const styles = getThumbnailCardStyles('/assets/suite/slides/layouts/title.webp')

  expect(styles.backgroundImage).toBe('url(/assets/suite/slides/layouts/title.webp)')
})
