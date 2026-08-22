type MediaElement = { type?: string; src?: string; poster?: string }
type Slide = { elements?: MediaElement[] }

export type MediaSource = { slideIndex: number; src: string }

// video bodies stay online, posters come along; a GIF's poster is its sidebar thumbnail
const imageSources = (element: MediaElement): string[] => {
	if (element.type === 'image') return [element.src ?? '', element.poster ?? '']
	if (element.type === 'video') return [element.poster ?? '']
	return []
}

export const collectMediaSources = (slides: Slide[]): MediaSource[] => {
	const seen = new Set<string>()
	const sources: MediaSource[] = []

	slides.forEach((slide, slideIndex) => {
		for (const element of slide.elements || []) {
			for (const src of imageSources(element)) {
				if (!src || seen.has(src)) continue
				seen.add(src)
				sources.push({ slideIndex, src })
			}
		}
	})

	return sources
}

export type LoadRequest = { url: string; params: Record<string, string> }

const PRESENTATION_METHOD = 'suite.slides.doctype.presentation.presentation'

// same urls and param order as the load path, so the cache keys match
export const presentationLoadRequests = (
	presentationId: string,
	{ readonly, composite }: { readonly: boolean; composite: boolean },
): LoadRequest[] => {
	const requests: LoadRequest[] = [
		{
			url: `${PRESENTATION_METHOD}.get_editor_access`,
			params: { doctype: 'Presentation', presentation_id: presentationId },
		},
	]

	if (!readonly) {
		requests.push({
			url: 'frappe.client.get',
			params: { doctype: 'Presentation', name: presentationId },
		})
		return requests
	}

	requests.push({
		url: `${PRESENTATION_METHOD}.get_public_presentation`,
		params: { name: presentationId },
	})
	if (composite) {
		requests.push({
			url: `${PRESENTATION_METHOD}.get_composite_presentation`,
			params: { name: presentationId },
		})
	}
	return requests
}
