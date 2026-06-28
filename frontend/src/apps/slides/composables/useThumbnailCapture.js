import { computed, ref, watch, nextTick } from 'vue'
import { debounce } from 'lodash'
import { call } from 'frappe-ui'

import { presentationDoc, unsyncedPresentationRecord, inReadonlyMode } from '@/apps/slides/stores/presentation'
import { slides } from '@/apps/slides/stores/slide'
import { focusElementId } from '@/apps/slides/stores/element'
import { dirty, isSaving } from '@/apps/slides/stores/saving'
import { captureDOM } from '@/apps/slides/utils/domToWebp'
import { getAttachmentUrl } from '@/apps/slides/utils/mediaUploads'

const DEBOUNCE_MS = 5000

export const useThumbnailCapture = (thumbnailCapture, hasOngoingInteraction) => {
	const pendingKey = ref('')
	const busy = ref(false)

	const slideKey = computed(() => getSlideKey())

	const firstSlide = () => slides.value[0]

	const presentationName = () => presentationDoc.value?.name

	const getSlideKey = () => {
		const slide = firstSlide()
		if (!slide) return ''

		return JSON.stringify({
			background: slide.background,
			elements: slide.elements || [],
		})
	}

	const markPending = (key) => {
		pendingKey.value = key
		schedule()
	}

	const canRun = () => {
		if (inReadonlyMode.value || !presentationDoc.value?.name || !slides.value.length) {
			return false
		}
		if (unsyncedPresentationRecord.value.deleted) return false
		if (!navigator.onLine || dirty.value || isSaving.value) return false
		if (hasOngoingInteraction.value || focusElementId.value != null) return false
		return true
	}

	const run = async () => {
		const key = pendingKey.value
		if (!key || busy.value) return

		if (!canRun()) {
			schedule()
			return
		}

		busy.value = true
		try {
			const data = await capture()
			if (!data || isStale(key)) return

			const url = await upload(data)
			if (isStale(key)) return

			await apply(url)
			clear(key)
		} catch (error) {
			console.warn('Could not generate presentation thumbnail', error)
		} finally {
			busy.value = false
			retryIfPending()
		}
	}

	const capture = async () => {
		await nextTick()
		return captureDOM(thumbnailCapture.value)
	}

	const upload = (base64Data) => {
		return call('suite.slides.doctype.presentation.presentation.save_presentation_thumbnail', {
			presentation_name: presentationName(),
			base64_data: base64Data,
		})
	}

	const evictThumbnailCache = async (url) => {
		if (!('caches' in window) || !url) return
		const cache = await caches.open('slides-media')
		// delete the exact URL the SW cached under — getAttachmentUrl() adds the
		// slides_media marker / proxy path, so the raw url alone wouldn't match
		await cache.delete(getAttachmentUrl(url))
	}

	const apply = async (thumbnail) => {
		await evictThumbnailCache(thumbnail)
		presentationDoc.value.thumbnail = thumbnail
		unsyncedPresentationRecord.value = {
			...unsyncedPresentationRecord.value,
			name: presentationName(),
			thumbnail,
		}
	}

	const isStale = (key) => {
		return pendingKey.value !== key
	}

	const clear = (key) => {
		if (!isStale(key)) {
			pendingKey.value = ''
		}
	}

	const retryIfPending = () => {
		if (pendingKey.value) {
			schedule()
		}
	}

	const onSlideChange = (key, oldKey) => {
		if (!key || !oldKey) return

		markPending(key)
	}

	const schedule = debounce(() => {
		run()
	}, DEBOUNCE_MS)

	const cancel = () => {
		schedule.cancel()
	}

	const reset = () => {
		pendingKey.value = ''
		cancel()
	}

	watch(slideKey, onSlideChange)

	return {
		cancel,
		reset,
	}
}
