<template>
  <!-- Hidden, and taking no room, until the frame first says how tall its message is: it shows
	     at its full height or not at all. Hidden with `invisible`, never `v-show`: the frame is made
	     as tall as its own document says it is, and a document that is not laid out has no height
	     to report. Under `display: none` the frame would never be measured, so never shown. The
	     frame also waits for the date reader, so the dates are in the first document it loads
	     rather than reloading it under the reader. -->
  <div class="w-full">
    <iframe
      v-if="srcdoc"
      ref="frame"
      class="w-full"
      :class="{ invisible: !isMeasured }"
      :style="{ height: `${height ?? 0}px` }"
      scrolling="yes"
      :srcdoc
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'

import { mailReader, useMailDates } from '@/apps/mail/composables/useMailDates'
import { isMac } from '@/apps/mail/utils'
import { useComposeMail, useScreenSize, useTheme } from '@/apps/mail/utils/composables'
import {
  declaresFixedPalette,
  isArtDirected,
  normalizeToLightScheme,
  remapEmailForDarkMode,
} from '@/apps/mail/utils/darkMail'
import { highlightBody } from '@/apps/mail/utils/highlightBody'
import type { NamedDate } from '@/apps/mail/utils/mailDates'
import { mailDocumentPolicy, scriptNonce } from '@/apps/mail/utils/mailDocumentPolicy'
import { parseMailto } from '@/apps/mail/utils/mailto'
import { findQuoteRoots } from '@/apps/mail/utils/quotedContent'
import { sanitizeEmailHtml } from '@/apps/mail/utils/sanitizeEmail'

// Whether to withhold remote content is the thread's to say: it offers a Show in each message that
// holds some (see HiddenImagesBanner), and lifts the block here once the reader asks.
// `highlight`: the words a search found the message by, marked in its body. `sentAt`: when the mail
// was sent; given it, the dates in the mail's own words are marked, read from then, and picking one
// asks for an event at it (`pickDate`).
// `asSent`: the reader asked to see the message as its sender designed it, on a light canvas,
// because the dark-theme remap spoiled it. Only the thread knows that, and it learns whether
// the remap applies at all from `adaptable`, which says so for the theme the app is in, shown
// as sent or not.
const {
  content,
  blockImages = false,
  highlight = '',
  sentAt,
  asSent = false,
} = defineProps<{
  content: string
  blockImages?: boolean
  highlight?: string
  sentAt?: string
  asSent?: boolean
}>()
const emit = defineEmits<{ pickDate: [date: NamedDate]; adaptable: [adaptable: boolean] }>()
const mailDates = useMailDates()

const { dataTheme } = useTheme()
const { isMobile } = useScreenSize()
const { requestCompose } = useComposeMail()
const frame = useTemplateRef<HTMLIFrameElement>('frame')

// How tall the message is, in pixels, as its frame last reported it; nothing until it first does.
const height = ref<number>()
const isMeasured = computed(() => height.value !== undefined)

// What the frame's own script tells the page: it cannot reach the page any other way.
const handleMessage = (event: MessageEvent) => {
  // Only this message's own frame says how tall it is: any window that can reach the page can
  // post to it, and every expanded message hears every frame.
  if (event.data?.type === 'height') {
    if (event.source !== frame.value?.contentWindow) return
    const reported: unknown = event.data.height
    if (typeof reported === 'number' && Number.isFinite(reported) && reported >= 0)
      height.value = reported
    return
  }
  // The message zoomed around the reader's fingers (see the frame's pinch): the frame is as tall as
  // it now is at once, not at the next render, so the thread can scroll by as much as the point
  // under the fingers moved, and it stays under them.
  if (event.data?.type === 'zoom') {
    const iframe = frame.value
    if (!iframe || event.source !== iframe.contentWindow) return
    const { height: reported, shift } = event.data
    if (typeof reported !== 'number' || !Number.isFinite(reported) || reported < 0) return
    height.value = reported
    iframe.style.height = `${reported}px`
    if (typeof shift === 'number' && Number.isFinite(shift)) {
      const thread = scrollerOf(iframe)
      if (thread) thread.scrollTop += shift
    }
    return
  }
  // Each touch point over the message, passed on for the thread's swipe-to-page (useThreadSwipe):
  // touches never leave the frame, so the pane cannot see them. Only this message's own frame's,
  // or every expanded message would pass on every frame's.
  if (event.data?.type === 'swipe-point') {
    if (event.source !== frame.value?.contentWindow) return
    const { phase, x, y, count } = event.data
    if (!['start', 'move', 'end', 'cancel'].includes(phase)) return
    if (typeof x !== 'number' || typeof y !== 'number') return
    window.dispatchEvent(
      new CustomEvent('email-swipe-point', {
        detail: { phase, x, y, count: typeof count === 'number' ? count : 1 },
      }),
    )
    return
  }
  // A date in the message the reader picked (see markMailDates), by its place in this render's list.
  if (event.data?.type === 'mail-date') {
    if (event.source !== frame.value?.contentWindow) return
    const date = body.value.dates[Number(event.data.index)]
    if (date) emit('pickDate', date)
    return
  }
  // A `mailto:` the reader clicked inside the message — open our own composer on it.
  // Only this message's own frame gets to do that: `window` hears every window that
  // can reach us (an attachment rendered in a frame, an embedder), and this one puts
  // a stranger's address and body in front of the user as a ready-to-send draft.
  if (event.data?.type === 'mailto') {
    if (event.source !== frame.value?.contentWindow) return

    const draft = parseMailto(String(event.data.href ?? ''))
    if (draft) requestCompose(draft)
    return
  }
  // A press inside the message, replayed from the frame element so the page's outside-press
  // handlers (reka's dismissable layers) see it land outside whatever popover is open. As a mouse
  // press: reka waits for a touch's click, and that click stays in the frame.
  if (event.data?.type === 'pointerdown') {
    const iframe = frame.value
    if (!iframe || event.source !== iframe.contentWindow) return
    iframe.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    return
  }
  // Only this message's own keys: every expanded message hears every frame's, and replaying them
  // all would press each key once per message.
  if (event.data?.type !== 'keyboard' || event.source !== frame.value?.contentWindow) return

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

// How far in a pinch zooms a message: this many times its own size.
const MAX_ZOOM = 3

const scrollerOf = (from: Element) => {
  for (let el = from.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    if (overflowY === 'auto' || overflowY === 'scroll') return el
  }
  return null
}

onMounted(() => window.addEventListener('message', handleMessage))
onUnmounted(() => window.removeEventListener('message', handleMessage))

// Collapse each quoted reply trail behind a toggle. findQuoteRoots knows every client's markup (Gmail,
// Outlook, Apple Mail, …) and hands back one outermost element per trail — hiding it hides any quotes
// nested inside.
const collapseQuotes = (doc: Document) => {
  findQuoteRoots(doc).forEach((quote) => {
    quote.classList.add('quote-hidden')
    // A labelled control, not a bare '···' chip — unlabelled, it was easy to miss
    // that a reply hides a whole conversation underneath it.
    const button = doc.createElement('button')
    button.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 11h16M4 16h10"/></svg>'
    const label = doc.createElement('span')
    label.textContent = __('Show trimmed content')
    // The toggle script runs inside the iframe, where __() doesn't exist — both
    // translations ride along as data attributes instead.
    button.dataset.show = __('Show trimmed content')
    button.dataset.hide = __('Hide trimmed content')
    button.appendChild(label)
    // Styled by the .quote-toggle rules in the srcdoc stylesheet — a class, not
    // inline styles, so the mobile variant can size the touch target up. The frame's script
    // toggles it: the frame's policy runs no inline handler.
    button.className = 'quote-toggle'
    quote.parentNode?.insertBefore(button, quote)
  })
}

const body = computed(() => {
  // Until the date reader has loaded, or failed to, the frame waits (see the template); the rest,
  // whether the theme adapts the message among it, is known already.
  const waiting = !!sentAt && mailDates.value === undefined
  const doc = new DOMParser().parseFromString(sanitizeEmailHtml(content, blockImages), 'text/html')
  // Two kinds of email render exactly as authored, dark theme or not: those
  // declaring a fixed palette (suite's own templates), and art-directed ones
  // — the author claimed the full canvas and painted with color — where
  // remapping would second-guess a deliberate design. Everything else (plain
  // mail, floating cards, replies quoting either kind) adapts to the dark
  // canvas. Art direction is a DOM-shape check, not "does it declare dark
  // support" — the email's own dark-scheme rules are dropped up front
  // (sanitization guts the selectors they rely on, and half a dark design is
  // worse than none), so every email is judged and remapped as its
  // light-scheme self. Remap runs before collapseQuotes so the toggle buttons
  // it inserts keep their exact theme colors.
  normalizeToLightScheme(doc)
  const adapts = dataTheme.value === 'dark' && !declaresFixedPalette(doc) && !isArtDirected(doc)
  const remapped = adapts && !asSent
  if (remapped) remapEmailForDarkMode(doc)
  // Before the search highlight, which cuts text into pieces a date could straddle.
  const dates =
    sentAt && mailDates.value
      ? mailDates.value.markMailDates(doc, sentAt, mailReader(), __('Create event'))
      : []
  if (doc.body) highlightBody(doc.body, highlight)
  collapseQuotes(doc)
  return { html: doc.documentElement.outerHTML, adapts, remapped, dates, waiting }
})

watch(
  () => body.value.adapts,
  (adapts) => emit('adaptable', adapts),
  { immediate: true },
)

// As sent, the frame takes the light theme whatever the app's: the sender's design on the
// canvas it was drawn for.
const frameTheme = computed(() => (asSent ? 'light' : dataTheme.value))
const colors = computed(() => THEME_CONFIG[frameTheme.value])
// The frame's own script is the one its policy runs. One nonce for the frame's lifetime: a fresh
// one would make each recomputed document differ and reload the frame for nothing.
const nonce = scriptNonce()

const srcdoc = computed(() => {
  if (body.value.waiting) return null
  const { html: transformedContent, remapped } = body.value

  return `
		<!DOCTYPE html>
		<html>
		<head>
			${mailDocumentPolicy(blockImages, nonce)}
			<meta name="viewport" content="width=device-width, initial-scale=1">
			<meta name="color-scheme" content="${frameTheme.value}">
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
				   both the width attribute and inline width, covering every fixed-width variant.
				   An author's own narrower cap is handed back by normalizeWidths() below, which
				   re-asserts it inline — the one declaration that outranks this one. */
				table, td, th, div {
					max-width: 100% !important;
				}

				/* Width only — never height. A blanket height:auto overrules authored
				   squares (an avatar with border-radius:50% renders as an ellipse of the
				   photo's intrinsic ratio). Images render as authored; the one case that
				   can't — a fixed width wider than the pane — is rewritten by
				   normalizeWidths() below, which drops that image's height with it. */
				img {
					max-width: 100% !important;
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

				.quote-toggle {
					display: inline-flex;
					align-items: center;
					gap: 6px;
					background: ${colors.value.button};
					color: ${colors.value.text};
					padding: 4px 9px;
					/* frappe-ui's standard button radius (rounded-4) */
					border-radius: 8px;
					transition: background .2s;
					margin: 12px 0;
					/* iOS paints its own tap highlight over a pressed button, which shows blue on a
					   phone; the press is shown by the button's own shade instead. */
					-webkit-tap-highlight-color: transparent;
				}

				/* A phone keeps :hover on whatever was tapped last, which held the button shaded after
				   a tap: there the shade lasts as long as the press. */
				@media (hover: hover) {
					.quote-toggle:hover {
						background: ${colors.value.buttonHover};
					}
				}

				.quote-toggle:active {
					background: ${colors.value.buttonHover};
				}

				/* A finger target on mobile — matches the app's 40px mobile buttons,
				   with the lg radius that size takes. Keyed on the app's own isMobile,
				   not an iframe media query: the iframe only knows the reading pane's
				   width, and a desktop pane narrowed by the sidebar is not a phone. */
				${
          isMobile.value
            ? `.quote-toggle {
						padding: 10px 14px;
						gap: 8px;
						border-radius: 10px;
					}
					.quote-toggle svg {
						width: 14px;
						height: 14px;
					}`
            : ''
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

				/* A date the reader can make an event of: underlined in the text's own colour, faintly,
				   so it reads on any canvas the mail paints, and drawn without moving a thing. */
				[data-mail-date] {
					text-decoration: underline;
					text-decoration-color: color-mix(in srgb, currentColor 50%, transparent);
					text-underline-offset: 2px;
					cursor: pointer;
				}

				[data-mail-date]:hover {
					text-decoration-color: currentColor;
				}

				/* Code keeps its line breaks and indentation but wraps a line too long for the
				   pane, as Gmail does: unwrapped, one long line (an inline <code> run in a
				   notification) widened the whole message past the pane. */
				pre, code {
					font-family: 'Courier New', Courier, monospace;
					white-space: pre-wrap;
				}
			</style>
		</head>
		<body>
			${transformedContent}
			<script nonce="${nonce}">
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
						const style = el.style;
						// The authored box is stashed before the first rewrite, since writing
						// '100%' destroys it and a resize back to a wide pane must restore it —
						// the iframe persists across pane-width changes.
						const img = el.tagName === 'IMG';
						if (img && el.dataset.authorWidth === undefined) {
							el.dataset.authorWidth = el.getAttribute('width') ?? '';
							el.dataset.authorStyleWidth = style.width;
							el.dataset.authorStyleHeight = style.height;
						}
						const attrWidth = img
							? parseInt(el.dataset.authorWidth, 10)
							: parseInt(el.getAttribute('width'), 10);
						const styleWidth = img ? el.dataset.authorStyleWidth : style.width;
						let clamped = false;
						if (attrWidth > limit) {
							el.setAttribute('width', '100%');
							clamped = true;
						} else if (img && attrWidth > 0) {
							el.setAttribute('width', el.dataset.authorWidth);
						}
						if (styleWidth.endsWith('px')) {
							if (parseFloat(styleWidth) > limit) {
								style.width = '100%';
								clamped = true;
							} else if (img) {
								style.width = styleWidth;
							}
						}
						// An image we narrowed must shed its authored height with the width, or
						// the photo squashes; one that fits again gets its authored box back —
						// otherwise the email is the author's.
						if (img) {
							if (clamped) style.height = 'auto';
							else style.height = el.dataset.authorStyleHeight;
						}
						if (style.minWidth.endsWith('px') && parseFloat(style.minWidth) > limit) style.minWidth = '0';

						// A percentage width capped by a pixel max-width is how every responsive
						// email builds its centered column. The sheet's blanket clamp outranks that
						// cap (stylesheet !important beats a plain inline declaration) and flattens
						// the column across the pane, so hand it back as inline !important — the one
						// declaration that outranks the sheet. Only while it is narrower than the
						// viewport: any wider and the clamp is what stops sideways scrolling. The
						// author's value is stashed on first pass, since writing to max-width
						// destroys it and a resize back to a wide pane has to restore it.
						if (el.dataset.authorMaxWidth === undefined && style.maxWidth.endsWith('px'))
							el.dataset.authorMaxWidth = style.maxWidth;
						const cap = parseFloat(el.dataset.authorMaxWidth);
						if (cap > 0)
							style.setProperty('max-width', cap > limit ? '100%' : el.dataset.authorMaxWidth, 'important');
					});
				};

				// The stylesheet clamp can also shrink an image normalizeWidths never
				// rewrote — a pixel width in a table cell narrower than the pane, or a
				// height-only declaration whose intrinsic width overflows. Only layout
				// knows, and only once the bitmap arrives (naturalWidth is 0 before
				// load): if the box the image got is narrower than the width its height
				// was drawn for, shed that height. Percentage widths are left alone —
				// fluid width against a fixed height is the author's own design.
				// A height-only image scales its width from that height, so the width
				// it was drawn for is the height at the bitmap's aspect — not the
				// bitmap's own width, which a 24px logo cut from a large PNG never
				// reaches and must not be inflated to.
				const unsquashImages = () => {
					document.querySelectorAll('img').forEach((img) => {
						const authored = img.dataset.authorWidth ?? img.getAttribute('width') ?? '';
						const authoredStyle = img.dataset.authorStyleWidth ?? img.style.width;
						if (authoredStyle.includes('%') || authored.includes('%')) return;
						const drawn =
							(authoredStyle.endsWith('px') && parseFloat(authoredStyle)) ||
							parseFloat(authored) ||
							(img.naturalHeight ? img.clientHeight * (img.naturalWidth / img.naturalHeight) : 0);
						if (!img.clientWidth) return;
						if (drawn > img.clientWidth + 1) {
							// Stash before overwriting, so widening the pane can undo this too.
							if (img.dataset.authorStyleHeight === undefined)
								img.dataset.authorStyleHeight = img.style.height;
							img.style.height = 'auto';
						} else if (img.style.height === 'auto' && img.dataset.authorStyleHeight !== undefined) {
							// The box fits again — the authored height comes back with it.
							img.style.height = img.dataset.authorStyleHeight;
						}
					});
				};

				// The last resort, as in Apple Mail: what still overflows once everything that can
				// reflow has (a row of fixed-size images, a nowrap run, a grid's own min-width) is
				// scaled down to the pane, never clipped at its edge or panned inside it. Zoom rather
				// than a transform, so the frame's measured height shrinks with it. A zoomed body that
				// kept following the pane would get wider by the same scale, and whatever takes its
				// width from the body (a 100% column with padding) would overflow again, so the body
				// is laid out once as on a pane as wide as the message, held at that width, and that
				// layout is what gets scaled. Everything is measured unzoomed, where every browser
				// agrees. Each pass lets go of the hold before anything else measures, so a pane that
				// widens gets the message back at full size.
				const root = document.documentElement;
				const bodyStyle = document.body.style;
				// The hold saves the value each property had just before it (a sent <body style>, or
				// what normalizeWidths wrote this pass) and puts it back on release; mail that fits
				// is never touched.
				let heldOver = null;
				const hold = (values) => {
					heldOver ??= {};
					Object.entries(values).forEach(([name, value]) => {
						if (!(name in heldOver))
							heldOver[name] = [bodyStyle.getPropertyValue(name), bodyStyle.getPropertyPriority(name)];
						bodyStyle.setProperty(name, value, 'important');
					});
				};
				const release = () => {
					if (!heldOver) return;
					Object.entries(heldOver).forEach(([name, saved]) => bodyStyle.setProperty(name, ...saved));
					heldOver = null;
				};
				let fit = 1;
				const fitToPane = () => {
					fit = 1;
					const pane = root.clientWidth;
					const content = root.scrollWidth;
					if (!pane || content <= pane + 1) return;
					const rootWidth = [root.style.getPropertyValue('width'), root.style.getPropertyPriority('width')];
					root.style.setProperty('width', content + 'px', 'important');
					const width = document.body.getBoundingClientRect().width;
					root.style.setProperty('width', ...rootWidth);
					hold({ 'box-sizing': 'border-box', width: width + 'px', 'min-width': '0', 'max-width': 'none' });
					fit = pane / root.scrollWidth;
					hold({ zoom: String(fit) });
				};

				// The reader's own zoom on top of that (a pinch, a double tap, below): 1 is the message as
				// fitted. A transform, not zoom: WebKit leaves out of a zoom the font sizes a mail sets
				// on its own elements, so their text would stay as it was while the rest grew. A scaled
				// body still reaches as wide and as low as it is drawn, so the frame scrolls sideways
				// over it and messageHeight measures it as drawn.
				let scale = 1;
				const applyScale = () => {
					if (scale === 1) {
						bodyStyle.removeProperty('transform');
						bodyStyle.removeProperty('transform-origin');
						return;
					}
					bodyStyle.setProperty('transform-origin', '0 0', 'important');
					bodyStyle.setProperty('transform', 'scale(' + scale + ')', 'important');
				};
				// Everything is measured unscaled, and a zoomed message is put back where it was scrolled to.
				const unscaled = (measure) => () => {
					const x = window.scrollX;
					bodyStyle.removeProperty('transform');
					measure();
					applyScale();
					if (scale !== 1) window.scrollTo(x, window.scrollY);
				};

				const normalizeAll = unscaled(() => {
					// Release first: normalizeWidths writes the same properties the hold saved.
					release();
					normalizeWidths();
					unsquashImages();
					fitToPane();
				});
				normalizeAll();
				// Only a new width lays the message out again: the frame also resizes each time the
				// message's height changes, as zooming does at every step. The root's box, not
				// clientWidth: a collapsed message's frame keeps its window's width, but its root has
				// no box, so a message first laid out when it is opened is laid out then.
				let laidOutWidth = root.getBoundingClientRect().width;
				window.addEventListener('resize', () => {
					const width = root.getBoundingClientRect().width;
					if (!width || width === laidOutWidth) return;
					laidOutWidth = width;
					normalizeAll();
				});
				// An image that fails changes the layout as surely as one that arrives, so both
				// refit; the window's own load is the backstop once every image has settled.
				const refit = unscaled(() => {
					// Release first, so what follows measures the unheld layout.
					release();
					unsquashImages();
					fitToPane();
				});
				document.querySelectorAll('img').forEach((img) => {
					img.addEventListener('load', refit);
					img.addEventListener('error', refit);
				});
				window.addEventListener('load', refit);

				// The frame is as tall as the page makes it, and the page only knows what it is told
				// here: the height of the message, each time it changes. A sheet that fills its window
				// (html, body { height: 100% }) would make the message as tall as the frame, which
				// could then never shrink to it, so both take their height from their content.
				root.style.setProperty('height', 'auto', 'important');
				bodyStyle.setProperty('height', 'auto', 'important');
				// The message is as tall as its root's box, unless something is drawn below that box:
				// positioned content, a negative margin. scrollHeight says how far down that reaches,
				// but never less than the frame's own height, so in a frame taller than the box it
				// says nothing, and only the elements themselves can tell. Their answer is held to
				// scrollHeight, which content clipped by its own container would otherwise pass.
				const messageHeight = () => {
					const box = Math.ceil(root.getBoundingClientRect().height);
					const reach = root.scrollHeight;
					if (reach <= box || reach > root.clientHeight) return Math.max(box, reach);
					let lowest = box;
					document.body.querySelectorAll('*').forEach((el) => {
						lowest = Math.max(lowest, el.getBoundingClientRect().bottom + window.scrollY);
					});
					return Math.min(Math.ceil(lowest), reach);
				};
				// Collapsed, the message is not laid out and has no height: the frame keeps the one
				// it had, and hears again when the message is opened.
				// Zoomed, the message is as tall as it is at its own size, times the zoom. Measuring that
				// can walk every element, so it is measured once and kept for as long as the message
				// stays as it is, not at each step of a pinch.
				let natural;
				const measureNatural = unscaled(() => {
					natural = messageHeight();
				});
				const scaledHeight = () => Math.ceil(natural * scale);
				let reported;
				// The frame resizes at each step of a zoom, to the height posted for it: what is drawn
				// below the root's box can only have moved when the message is at its own size.
				const reportHeight = (remeasure = true) => {
					// Not clientWidth: a hidden frame keeps its window's width, but its root has no box.
					if (!root.getBoundingClientRect().width) return;
					if (remeasure || natural === undefined) measureNatural();
					const height = scaledHeight();
					if (height === reported) return;
					reported = height;
					window.parent.postMessage({ type: 'height', height }, '*');
				};
				// Whatever changes the root's box is seen here: an image or a font arriving, the
				// quoted trail opening, the pane changing width. What is drawn below the box can
				// change without it, when an image there arrives or the frame is resized.
				const remeasureHeight = () => reportHeight();
				new ResizeObserver(remeasureHeight).observe(root);
				window.addEventListener('resize', () => reportHeight(scale === 1));
				window.addEventListener('load', remeasureHeight);
				document.querySelectorAll('img').forEach((img) => {
					img.addEventListener('load', remeasureHeight);
					img.addEventListener('error', remeasureHeight);
				});

				// Forward keyboard events to parent
				['keydown', 'keyup', 'keypress'].forEach(eventType => {
					document.addEventListener(eventType, (e) => {
						// ⌘P on a Mac, Ctrl+P elsewhere, is the thread's: forwarded, it prints the
						// conversation. Left to the browser too, it would first print the whole app.
						if (eventType === 'keydown' && e.${isMac ? 'metaKey' : 'ctrlKey'} && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p')
							e.preventDefault();
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

				// Presses never leave the frame, so a popover open over the page (a message's
				// details, an invite's event) could not hear the one that should close it.
				document.addEventListener('pointerdown', () => {
					window.parent.postMessage({ type: 'pointerdown' }, '*');
				});

				// A date picked in the message goes to the app to make an event of: a press and release
				// in place that selected nothing. A drag, or a press that ends a selection, is the reader
				// selecting text.
				const pickDate = (mark) =>
					window.parent.postMessage({ type: 'mail-date', index: mark.dataset.mailDate }, '*');
				document.addEventListener('keydown', (e) => {
					const mark = e.target.closest?.('[data-mail-date]');
					if (!mark || (e.key !== 'Enter' && e.key !== ' ')) return;
					e.preventDefault();
					pickDate(mark);
				});
				// A date is focusable so Tab reaches it, but a browser starts no selection at the edge of
				// a focusable element: while a press on it lasts it isn't one. It is again once the press
				// ends, wherever it ends, and before any key can move focus. Where the press began tells
				// a tap from a drag; a click with no press of its own (a screen reader's) is a pick.
				let press = null;
				let unfocused = null;
				const refocusable = () => {
					unfocused?.setAttribute('tabindex', '0');
					unfocused = null;
				};
				document.addEventListener('pointerdown', (e) => {
					refocusable();
					const mark = e.target.closest?.('[data-mail-date]');
					press = mark ? { x: e.clientX, y: e.clientY, date: mark.dataset.mailDate } : null;
					if (!mark?.hasAttribute('tabindex')) return;
					mark.removeAttribute('tabindex');
					unfocused = mark;
				}, true);
				['pointerup', 'lostpointercapture', 'keydown'].forEach((type) =>
					document.addEventListener(type, refocusable, true),
				);
				document.addEventListener('pointercancel', () => {
					refocusable();
					press = null;
				}, true);
				// A drag let go outside the frame sends no pointerup here: the pointer back without a
				// button down says it is over.
				document.addEventListener('pointermove', (e) => {
					if (!e.buttons) refocusable();
				}, true);
				const moved = (e, mark) => {
					const pressed = press;
					press = null;
					if (!pressed || pressed.date !== mark.dataset.mailDate) return false;
					return Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 4;
				};

				// Forward link clicks to parent. A link comes first, whatever is around it: the frame
				// never follows one itself.
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
						return;
					}
					// A quoted trail's toggle (see collapseQuotes) shows or hides the trail after it.
					const toggle = e.target.closest('.quote-toggle');
					if (toggle?.nextElementSibling && toggle.lastElementChild) {
						const hidden = toggle.nextElementSibling.classList.toggle('quote-hidden');
						toggle.lastElementChild.textContent = hidden ? toggle.dataset.show : toggle.dataset.hide;
						return;
					}
					const mark = e.target.closest('[data-mail-date]');
					if (!mark) return;
					e.preventDefault();
					if (!moved(e, mark) && document.getSelection()?.isCollapsed !== false) pickDate(mark);
				});

				// Every touch point goes up to the page, which pulls the thread sideways under the finger
				// (useThreadSwipe): touches never leave the frame, so the page cannot see them otherwise.
				// Screen coordinates, as the page reads its own: the frame moves with the thread it is
				// in, so a point inside it would shift under the finger. A gesture that starts on
				// horizontally scrollable content (an overflowing body included) means scroll, and is
				// not sent.
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
				const sendPoint = (phase, touch, count) => window.parent.postMessage(
					{ type: 'swipe-point', phase, x: touch.screenX, y: touch.screenY, count }, '*');
				// The page decides what the gesture is by the same rule (LOCK_AT in swipeGesture.ts):
				// this copy only knows when to stop the frame scrolling under a drag.
				let swipeOrigin = null;
				let swipeLock = null;
				// A second finger makes it a pinch or a two-finger scroll for good: the page is told, and
				// lets it go, and the frame leaves it to the browser.
				document.addEventListener('touchstart', (e) => {
					swipeLock = e.touches.length > 1 ? 'scroll' : null;
					swipeOrigin = !inHorizontalScroller(e.target) ? e.touches[0] : null;
					if (swipeOrigin) sendPoint('start', swipeOrigin, e.touches.length);
				}, { passive: true });
				// Once it is a scroll the page has nothing more to do with it until it ends.
				document.addEventListener('touchmove', (e) => {
					const touch = e.touches[0];
					if (!swipeOrigin || !touch || swipeLock === 'scroll') return;
					const dx = touch.screenX - swipeOrigin.screenX;
					const dy = touch.screenY - swipeOrigin.screenY;
					if (!swipeLock && Math.hypot(dx, dy) >= 10)
						swipeLock = Math.abs(dx) > Math.abs(dy) ? 'drag' : 'scroll';
					if (swipeLock === 'scroll') return;
					if (swipeLock === 'drag' && e.cancelable) e.preventDefault();
					sendPoint('move', touch);
				}, { passive: false });
				document.addEventListener('touchend', (e) => {
					if (!swipeOrigin) return;
					swipeOrigin = null;
					sendPoint('end', e.changedTouches[0]);
				}, { passive: true });
				document.addEventListener('touchcancel', (e) => {
					if (!swipeOrigin) return;
					swipeOrigin = null;
					sendPoint('cancel', e.changedTouches[0]);
				}, { passive: true });

				// Pinch to zoom the message, as a phone's own mail app does: the app around it (its
				// toolbar, the subject, the reply bar) stays as it is, so the browser's zoom is off for
				// the page and this zooms the message alone, from fitted to ${MAX_ZOOM} times its size.
				// Zoomed in, it is wider than the frame and scrolls sideways in it (which is also what
				// stops a sideways drag paging the thread, above), and taller, so the frame grows and
				// the thread scrolls by as much as the point under the fingers moved down: it stays
				// under them. A double tap zooms in on where it lands, or back out.
				const zoomAt = (next, x, y, panX = 0, panY = 0) => {
					const before = scale;
					const pageX = window.scrollX + x;
					const pageY = window.scrollY + y;
					scale = Math.min(Math.max(next, 1), Math.max(1, ${MAX_ZOOM} / fit));
					applyScale();
					const ratio = scale / before;
					window.scrollTo(pageX * ratio - x - panX, window.scrollY);
					if (natural === undefined) measureNatural();
					const height = scaledHeight();
					reported = height;
					window.parent.postMessage({ type: 'zoom', height, shift: pageY * ratio - pageY - panY }, '*');
					return ratio;
				};
				let pinch = null;
				let animation = 0;
				const between = (a, b) => ({
					x: (a.clientX + b.clientX) / 2,
					y: (a.clientY + b.clientY) / 2,
					// Screen points for how far the fingers went: the frame moves under them as it zooms
					screenX: (a.screenX + b.screenX) / 2,
					screenY: (a.screenY + b.screenY) / 2,
					apart: Math.hypot(a.screenX - b.screenX, a.screenY - b.screenY),
				});
				document.addEventListener('touchstart', (e) => {
					cancelAnimationFrame(animation);
					if (e.touches.length === 2) {
						const at = between(e.touches[0], e.touches[1]);
						pinch = { ...at, scale };
					} else if (e.touches.length > 2) pinch = null;
				}, { passive: true });
				// Not passive: the browser would zoom the whole app with the same fingers. A finger
				// left down once the other lifts goes on panning, as the browser won't take it over.
				document.addEventListener('touchmove', (e) => {
					if (!pinch) return;
					if (e.cancelable) e.preventDefault();
					if (e.touches.length === 2) {
						const at = between(e.touches[0], e.touches[1]);
						zoomAt(pinch.scale * (at.apart / pinch.apart), at.x, at.y, at.screenX - pinch.screenX, at.screenY - pinch.screenY);
						Object.assign(pinch, { screenX: at.screenX, screenY: at.screenY });
					} else {
						const touch = e.touches[0];
						zoomAt(scale, touch.clientX, touch.clientY, touch.screenX - pinch.screenX, touch.screenY - pinch.screenY);
						Object.assign(pinch, { screenX: touch.screenX, screenY: touch.screenY });
					}
				}, { passive: false });
				document.addEventListener('gesturestart', (e) => e.preventDefault());

				const zoomTo = (target, x, y) => {
					const from = scale;
					const start = performance.now();
					const step = (now) => {
						const done = Math.min(1, (now - start) / 200);
						const ratio = zoomAt(from + (target - from) * (1 - (1 - done) ** 3), x, y);
						// The point zoomed around is where it was on screen, so lower in the grown frame
						y = (window.scrollY + y) * ratio - window.scrollY;
						if (done < 1) animation = requestAnimationFrame(step);
					};
					animation = requestAnimationFrame(step);
				};
				let tap = null;
				let lastTap = null;
				document.addEventListener('touchstart', (e) => {
					const touch = e.touches[0];
					tap = e.touches.length === 1 ? { x: touch.screenX, y: touch.screenY, t: e.timeStamp } : null;
					if (!tap) lastTap = null;
				}, { passive: true });
				document.addEventListener('touchmove', (e) => {
					const touch = e.touches[0];
					if (tap && Math.hypot(touch.screenX - tap.x, touch.screenY - tap.y) > 10) tap = null;
				}, { passive: true });
				// Not passive: a double tap is the zoom's, not a second click on what it landed on
				document.addEventListener('touchend', (e) => {
					if (pinch) {
						const left = e.touches[0];
						if (left) Object.assign(pinch, { screenX: left.screenX, screenY: left.screenY });
						else pinch = null;
						return;
					}
					if (!tap || e.touches.length) return;
					const touch = e.changedTouches[0];
					const second = lastTap && tap.t - lastTap.t < 300 &&
						Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 40;
					lastTap = second ? null : tap;
					tap = null;
					if (!second || e.target.closest?.('a, button, input, select, textarea, label, summary, [data-mail-date]')) return;
					if (e.cancelable) e.preventDefault();
					zoomTo(scale > 1.01 ? 1 : 2, touch.clientX, touch.clientY);
				}, { passive: false });
				document.addEventListener('touchcancel', () => {
					pinch = null;
					tap = null;
				}, { passive: true });
			<\/script>
		</body>
		</html>
	`
})

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
