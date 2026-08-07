<template>
	<div
		v-if="showImagesBanner"
		class="text-ink-gray-6 mb-3 flex flex-col gap-3 rounded border p-2.5 px-4 sm:flex-row sm:items-center"
	>
		<div class="flex min-w-0 flex-1 items-center gap-3">
			<ImageOff class="h-4.5 w-4.5 shrink-0 stroke-1.5" />
			<span class="text-ink-gray-8 min-w-0 flex-1"> {{ blockedLabel }} </span>
		</div>
		<div class="flex shrink-0 items-center justify-end gap-3">
			<Button
				v-if="canTrust"
				variant="ghost"
				:label="__('Mark Sender as Trusted')"
				@click="handleTrust"
			/>
			<Button :label="__('Load Images')" class="w-28" @click="imagesLoaded = true" />
		</div>
	</div>
	<div v-if="!isIframeReady" class="animate-pulse space-y-2 py-4">
		<div
			v-for="i in 5"
			:key="i"
			class="bg-surface-gray-3 h-2"
			:style="{ width: `${Math.floor(Math.random() * 40) + 60}%` }"
		/>
	</div>
	<IframeResizer
		ref="frame"
		v-show="isIframeReady"
		class="w-full"
		license="GPLv3"
		:scrolling="true"
		:srcdoc
		@on-ready="isIframeReady = true"
	/>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue'
import iframeResizerChildScript from '@iframe-resizer/child/index.umd.js?raw'
// The package maps `./sfc` only via its (non-honored) `browser` field under
// Vite 8/Rolldown, so import the concrete SFC file directly.
// eslint-disable-next-line import/no-unresolved
import IframeResizer from '@iframe-resizer/vue/iframe-resizer.vue'
import DOMPurify from 'dompurify'
import { ImageOff } from 'lucide-vue-next'
import { Button } from 'frappe-ui'

import { analyzeRemoteAssets, blockRemoteAssets } from '@/apps/mail/utils'
import { escapeBracketedAddresses } from '@/apps/mail/utils/html'
import { useComposeMail, useTheme } from '@/apps/mail/utils/composables'
import { parseMailto } from '@/apps/mail/utils/mailto'
import { isArtDirected, normalizeToLightScheme, remapEmailForDarkMode } from '@/apps/mail/utils/darkMail'

const {
	content,
	blockImages = false,
	canTrust = true,
} = defineProps<{ content: string; blockImages?: boolean; canTrust?: boolean }>()
const emit = defineEmits<{ trust: [] }>()

const { dataTheme } = useTheme()
const { requestCompose } = useComposeMail()
const frame = useTemplateRef<{ $el: HTMLIFrameElement }>('frame')

const isIframeReady = ref(false)

// Remote images are withheld until the reader opts in (per message), so a sender can't use them to track
// when their mail was opened.
const imagesLoaded = ref(false)
// Trusting dismisses the banner instantly (and reveals images) without waiting for the sender's accept to
// round-trip — otherwise the bar lingers before it disappears.
const trusted = ref(false)
const effectiveBlock = computed(() => blockImages && !imagesLoaded.value && !trusted.value)
const remoteAssets = computed(() => analyzeRemoteAssets(content))
// The banner is dismissed once the reader loads the images (or trusts the sender) — there's nothing
// left to act on after that.
const showImagesBanner = computed(
	() => blockImages && !imagesLoaded.value && !trusted.value && remoteAssets.value.hasRemote,
)
const blockedLabel = computed(() => {
	const n = remoteAssets.value.images
	if (n === 0) return __('Remote content hidden to protect your privacy.')
	return n === 1
		? __('1 remote image hidden to protect your privacy.')
		: __('{0} remote images hidden to protect your privacy.', [String(n)])
})

// Trusting reveals images and dismisses the banner now; the parent accepts the sender for future mail.
const handleTrust = () => {
	trusted.value = true
	emit('trust')
}

// Listen for keyboard/swipe events from iframe
const handleMessage = (event: MessageEvent) => {
	// Horizontal swipes detected inside the iframe, re-broadcast for the thread pane's
	// swipe navigation (MailboxView listens; it dedupes across EmailContent instances).
	if (event.data?.type === 'swipe') {
		window.dispatchEvent(new CustomEvent('email-swipe', { detail: event.data.direction }))
		return
	}
	// A `mailto:` the reader clicked inside the message — open our own composer on it.
	// Only this message's own frame gets to do that: `window` hears every window that
	// can reach us (an attachment rendered in a frame, an embedder), and this one puts
	// a stranger's address and body in front of the user as a ready-to-send draft.
	if (event.data?.type === 'mailto') {
		if (event.source !== (frame.value?.$el as HTMLIFrameElement | undefined)?.contentWindow)
			return

		const draft = parseMailto(String(event.data.href ?? ''))
		if (draft) requestCompose(draft)
		return
	}
	if (event.data?.type !== 'keyboard') return

	// Create a synthetic keyboard event in the parent
	const keyboardEvent = new KeyboardEvent(event.data.eventType, {
		key: event.data.key,
		ctrlKey: event.data.ctrlKey,
		shiftKey: event.data.shiftKey,
		altKey: event.data.altKey,
		metaKey: event.data.metaKey,
		bubbles: true,
	})
	document.dispatchEvent(keyboardEvent)
}

onMounted(() => window.addEventListener('message', handleMessage))
onUnmounted(() => window.removeEventListener('message', handleMessage))

// Collapse each top-level quoted reply (gmail_quote / frappe_mail_quote) behind a "···" toggle. Done on
// the DOM, not regex: a quote with nested divs is wrapped as one unit, instead of the old regex stopping
// at the first </div> and collapsing the wrong region.
const collapseQuotes = (doc: Document) => {
	doc.querySelectorAll('.gmail_quote, .frappe_mail_quote').forEach((quote) => {
		// Only the outermost quote gets a toggle — hiding it hides any quotes nested inside.
		if (quote.parentElement?.closest('.gmail_quote, .frappe_mail_quote')) return
		quote.classList.add('quote-hidden')
		const button = doc.createElement('button')
		button.textContent = '···'
		button.setAttribute(
			'style',
			`background:${colors.value.button};color:${colors.value.text};padding:0.5px 6px;border-radius:8px;cursor:pointer;transition:background .2s;margin:12px 0;`,
		)
		button.setAttribute('onmouseover', `this.style.background='${colors.value.buttonHover}'`)
		button.setAttribute('onmouseout', `this.style.background='${colors.value.button}'`)
		button.setAttribute('onclick', "this.nextElementSibling.classList.toggle('quote-hidden');")
		quote.parentNode?.insertBefore(button, quote)
	})
}

const srcdoc = computed(() => {
	let sanitized = DOMPurify.sanitize(escapeBracketedAddresses(content), DOMPURIFY_CONFIG)
	if (effectiveBlock.value) sanitized = blockRemoteAssets(sanitized)
	const doc = new DOMParser().parseFromString(sanitized, 'text/html')
	// Art-directed emails — the author claimed the full canvas and painted with
	// color — render exactly as authored, dark theme or not; remapping them
	// would second-guess a deliberate design. Everything else (plain mail,
	// floating cards, replies quoting either kind) adapts to the dark canvas.
	// Note this is a DOM-shape check, not "does it declare dark support" — the
	// email's own dark-scheme rules are dropped up front (sanitization guts the
	// selectors they rely on, and half a dark design is worse than none), so
	// every email is judged and remapped as its light-scheme self. Remap runs
	// before collapseQuotes so the toggle buttons it inserts keep their exact
	// theme colors.
	normalizeToLightScheme(doc)
	const remapped = dataTheme.value === 'dark' && !isArtDirected(doc)
	if (remapped) remapEmailForDarkMode(doc)
	collapseQuotes(doc)
	const transformedContent = doc.documentElement.outerHTML

	/* eslint-disable no-useless-escape */
	return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta name="viewport" content="width=device-width, initial-scale=1">
			<meta name="color-scheme" content="${dataTheme.value}">
			<meta charset="UTF-8">
			<style>
				body {
					font-family: InterVar, ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
					font-size: 14px;
					line-height: 1.25rem;
					background-color: ${colors.value.background};
					/* Art-directed (unremapped) emails bring a light-calibrated design of
					   their own, so the fallback text color follows the light theme then. */
					color: ${remapped ? colors.value.text : THEME_CONFIG.light.text};
					margin: 0;
					/* 'anywhere' (unlike 'break-word') also shrinks min-content width, so an
					   unbreakable run (nbsp-joined text, long URLs) inside a table cell can't
					   force the table wider than the viewport. */
					overflow-wrap: anywhere;
				}

				/* Emails routinely hardcode widths (width attrs, inline styles); clamp them to the
				   viewport so the message reflows instead of scrolling sideways. max-width wins over
				   both the width attribute and inline width, covering every fixed-width variant. */
				table, td, th, div {
					max-width: 100% !important;
				}

				img {
					max-width: 100% !important;
					height: auto !important;
				}

				blockquote {
					margin: 8px 0;
					padding-left: 12px;
					border-left: 1px solid ${colors.value.buttonHover};
				}

				/* Fallback for links the email leaves uncolored — the UA default
				   (#0000EE) is unreadable on the remapped dark canvas. Author styles
				   come later in the document, so they still win. */
				${remapped ? `a { color: ${THEME_CONFIG.dark.link}; }` : ''}

				table {
					color: inherit !important;
				}

				button {
					background: none;
					border: none;
					cursor: pointer;
					padding: 0;
				}

				.quote-hidden {
					display: none;
				}

				.email-pixel {
					display: none !important;
					visibility: hidden !important;
					width: 0 !important;
					height: 0 !important;
					overflow: hidden !important;
				}

				img[data-blocked-image] {
					display: none !important;
				}

				pre, code {
					font-family: 'Courier New', Courier, monospace;
					white-space: pre;
					overflow-x: auto;
				}
			</style>
			<script> ${iframeResizerChildScript} <\/script>
		</head>
		<body>
			${transformedContent}
			<script>
				// The stylesheet's max-width clamp can't reach fixed-width tables nested
				// inside other tables: during the outer table's intrinsic sizing a
				// percentage max-width counts as auto, so the inner pixel width still
				// propagates up and the whole grid overflows. Rewrite any fixed pixel
				// width wider than the sheet instead. Desktop panes are wider than the
				// usual 600px email grid, so this effectively only bites on mobile.
				const normalizeWidths = () => {
					const limit = document.documentElement.clientWidth;
					if (!limit) return;
					document.querySelectorAll('[width], [style*="width"]').forEach((el) => {
						if (parseInt(el.getAttribute('width'), 10) > limit) el.setAttribute('width', '100%');
						const style = el.style;
						if (style.width.endsWith('px') && parseFloat(style.width) > limit) style.width = '100%';
						if (style.maxWidth.endsWith('px') && parseFloat(style.maxWidth) > limit) style.maxWidth = '100%';
						if (style.minWidth.endsWith('px') && parseFloat(style.minWidth) > limit) style.minWidth = '0';
					});
				};
				normalizeWidths();
				window.addEventListener('resize', normalizeWidths);

				// Forward keyboard events to parent
				['keydown', 'keyup', 'keypress'].forEach(eventType => {
					document.addEventListener(eventType, (e) => {
						window.parent.postMessage({
							type: 'keyboard',
							eventType: eventType,
							key: e.key,
							ctrlKey: e.ctrlKey,
							shiftKey: e.shiftKey,
							altKey: e.altKey,
							metaKey: e.metaKey,
						}, '*');
					});
				});

				// Forward link clicks to parent
				document.addEventListener('click', (e) => {
					const anchor = e.target.closest('a');
					if (anchor) {
						e.preventDefault();
						const href = anchor.getAttribute('href')?.trim();
						if (!href) return;
						// A mailto belongs to this app: opening it would hand the OS's default
						// mail client a draft the user has to finish somewhere else.
						if (/^mailto:/i.test(href)) {
							window.parent.postMessage({ type: 'mailto', href: anchor.href }, '*');
							return;
						}
						window.open(anchor.href, '_blank');
					}
				});

				// Forward horizontal swipes to the parent — touches never leave the iframe, so
				// the thread pane's swipe navigation can't see them otherwise. A gesture that
				// starts on horizontally scrollable content (incl. an overflowing body) means
				// scroll, not navigate.
				const inHorizontalScroller = (el) => {
					const doc = document.documentElement;
					if (doc.scrollWidth > doc.clientWidth + 1) return true;
					for (; el && el.nodeType === 1; el = el.parentElement) {
						if (el.scrollWidth > el.clientWidth + 1) {
							const overflowX = getComputedStyle(el).overflowX;
							if (overflowX === 'auto' || overflowX === 'scroll') return true;
						}
					}
					return false;
				};
				let swipeOrigin = null;
				document.addEventListener('touchstart', (e) => {
					swipeOrigin = e.touches.length === 1 && !inHorizontalScroller(e.target)
						? { x: e.touches[0].clientX, y: e.touches[0].clientY }
						: null;
				}, { passive: true });
				document.addEventListener('touchend', (e) => {
					if (!swipeOrigin) return;
					const dx = e.changedTouches[0].clientX - swipeOrigin.x;
					const dy = e.changedTouches[0].clientY - swipeOrigin.y;
					swipeOrigin = null;
					if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 2) return;
					window.parent.postMessage({ type: 'swipe', direction: dx < 0 ? 'left' : 'right' }, '*');
				}, { passive: true });
			<\/script>
		</body>
		</html>
	`
})

const colors = computed(() => THEME_CONFIG[dataTheme.value])

const DOMPURIFY_CONFIG = {
	ALLOWED_TAGS: [
		'html',
		'head',
		'body',
		'title',
		'meta',
		'style',
		'table',
		'tbody',
		'thead',
		'tfoot',
		'tr',
		'td',
		'th',
		'div',
		'span',
		'p',
		'br',
		'strong',
		'b',
		'em',
		'i',
		'u',
		// Highlighted text. Without it KEEP_CONTENT hands the words back unstyled, so a
		// highlight applied in our own composer came back to the reader as plain text —
		// while the text colour beside it, which rides a <span>, survived.
		'mark',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'a',
		'img',
		'blockquote',
		'ul',
		'ol',
		'li',
		'pre',
		'code',
	],
	ALLOWED_ATTR: [
		'style',
		'class',
		'id',
		'width',
		'height',
		'align',
		'valign',
		'cellpadding',
		'cellspacing',
		// Without colspan/rowspan a table email's grid falls apart: rows stop
		// agreeing on column count, cells get crushed to slivers, and text can
		// land outside its authored background (seen as invisible/vertical text).
		'colspan',
		'rowspan',
		'border',
		'bgcolor',
		'color',
		'href',
		'src',
		'alt',
		'title',
		'target',
		'data-type',
		'data-id',
		'data-label',
		'data-list',
		'data-email-footer',
		'xmlns',
		'content',
		'name',
		'http-equiv',
		'charset',
	],
	KEEP_CONTENT: true,
	ALLOW_UNKNOWN_PROTOCOLS: false,
	WHOLE_DOCUMENT: true,
	ADD_TAGS: ['meta', 'style', 'pre', 'code'],
	ADD_ATTR: ['cellpadding', 'cellspacing', 'border', 'bgcolor', 'xmlns', 'charset'],
	REMOVE_EMPTY: false,
}

const THEME_CONFIG = {
	light: {
		background: '#FFFFFF',
		text: '#383838',
		button: '#F3F3F3',
		buttonHover: '#EDEDED',
		link: '',
	},
	dark: {
		// Match frappe-ui v2's dark `surface-base` (#171717) so the email body doesn't seam against
		// the reading-pane background. Iframes don't inherit the parent's CSS vars, so it's concrete.
		// Colors the email itself carries are remapped onto this canvas by remapEmailForDarkMode.
		background: '#171717',
		text: '#D4D4D4',
		button: '#2B2B2B',
		buttonHover: '#343434',
		link: '#6CB6FF',
	},
}
</script>
