import { describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'

const currentSlide = shallowRef<any>(null)
const addMediaElement = vi.fn()
const replaceMediaElement = vi.fn()

let resolveUpload: (fileDoc: unknown) => void

vi.mock('@/apps/slides/stores/presentation', () => ({
	presentationId: ref('p1'),
	presentationDoc: ref({ owner: 'u1' }),
}))
vi.mock('@/apps/slides/stores/slide', () => ({ currentSlide }))
vi.mock('@/apps/slides/stores/element', () => ({ addMediaElement, replaceMediaElement }))
vi.mock('@/boot/session', () => ({ session: { user: { sessionUser: 'u1' } } }))
vi.mock('frappe-ui', () => ({
	call: vi.fn(),
	toast: { promise: (promise: Promise<unknown>) => promise },
	FileUploadHandler: class {
		upload() {
			return new Promise((resolve) => {
				resolveUpload = resolve
			})
		}
	},
}))

const { handleUploadedMedia } = await import('./mediaUploads')

const videoFile = () => new File(['x'], 'clip.mp4', { type: 'video/mp4' })

describe('slow uploads', () => {
	it('add the media to the slide the upload was started on', async () => {
		const startedOn = { clientId: 'A', elements: [] }
		currentSlide.value = startedOn

		handleUploadedMedia([videoFile()])

		currentSlide.value = { clientId: 'B', elements: [] }
		resolveUpload({ file_url: '/private/files/clip.mp4', name: 'f1' })

		await vi.waitFor(() => expect(addMediaElement).toHaveBeenCalled())
		expect(addMediaElement.mock.calls[0][2]).toBe(startedOn)
	})
})
