// dot-boundary host check, e.g. "youtube.com" matches "www.youtube.com" but not "notyoutube.com"
const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com']

const matchesYoutubeHost = (hostname) =>
	YOUTUBE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))

// pulls a video id out of any shape of YouTube URL (watch, share, shorts, live, embed)
export const getYoutubeVideoId = (url) => {
	let parsed
	try {
		parsed = new URL(String(url).trim())
	} catch {
		return null
	}

	if (!matchesYoutubeHost(parsed.hostname)) return null

	if (parsed.hostname === 'youtu.be' || parsed.hostname === 'www.youtu.be') {
		return parsed.pathname.slice(1).split('/')[0] || null
	}

	const segments = parsed.pathname.split('/').filter(Boolean)
	if (['shorts', 'live', 'embed'].includes(segments[0])) {
		return segments[1] || null
	}

	return parsed.searchParams.get('v') || null
}

export const getYoutubeEmbedSrc = (videoId) => `https://www.youtube.com/embed/${videoId}?rel=0`

export const getYoutubeThumbnailSrc = (videoId) =>
	`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
