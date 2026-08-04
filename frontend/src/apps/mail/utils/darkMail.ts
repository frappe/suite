// Deterministic dark-mode remapping for third-party email HTML.
//
// Strategy (the one Gmail/Proton converged on): rewrite every color literal the
// email carries — inline styles, <style> sheets, legacy bgcolor/color
// attributes — through one pure function, instead of guessing at the rendered
// result with DOM heuristics. Because the same mapping is applied uniformly to
// every declaration, whichever rule wins the cascade is already remapped; no
// computed styles or ancestor walks needed, and no half-transformed states.
//
// Colors are mapped in OKLab: backgrounds are inverted end-to-end so any two
// surfaces that contrasted in light mode still contrast in dark; gray text is
// flipped into a light band; colorful text (the author's voice — a red "down",
// a brand link) is kept byte-identical unless it lacks contrast against the
// dark canvas, in which case it is brightened just enough, hue untouched.

export type ColorRole = 'fg' | 'bg' | 'border'

// OKLab lightness of #171717 — frappe-ui's dark surface-base and the reading
// pane's canvas. White backgrounds map exactly onto it so remapped emails seam
// into the pane instead of floating as a slightly-off card.
const DARK_CANVAS_L = 0.2048

// Backgrounds must be a strict inversion — injective — because clamping
// against identity collides the axis's two ends: white pages land on the
// canvas (L 0.2048) while an authored near-black CTA (slate-900, L ≈ 0.21)
// would pass through onto the same surface and vanish. Inverting the whole
// axis keeps distinct surfaces distinct and gives authored-dark elements
// dark-mode elevation instead. The 0.7 exponent spends more of the dark band
// on the light end, where emails do most of their layering.
const invertBackgroundL = (L: number) => DARK_CANVAS_L + 0.12 * (1 - L) ** 0.7

// Smallest relative luminance that still gives 4.5:1 (WCAG AA body text)
// contrast over the #171717 canvas — the floor colorful text is held to.
const MIN_FG_LUMINANCE = 0.216

// Backgrounds keep a hint of their hue but are desaturated toward the dark
// canvas — a saturated brand banner should read as a tinted dark surface, not
// a neon slab.
const BG_MAX_CHROMA = 0.1

// Where visible borders land in dark mode (≈ #333 on the #171717 canvas).
// Pure background inversion maps a light hairline (#e5e7eb) a whisker above
// the canvas, where dark lightness deltas compress into invisibility — a
// divider authored to be seen must stay seen.
const HAIRLINE_L = 0.32

// Was this color authored as gray or as a color? Authors reach for blue-tinted
// grays (Tailwind slate & friends) as "gray" on white, where the tint is
// imperceptible; moved onto a dark canvas verbatim it reads as lavender or
// navy. Smoothstepped: chroma below 0.05 is gray (0), above 0.15 (links,
// brand colors) is color (1).
const colorfulness = (C: number) => {
	const t = Math.min(1, Math.max(0, (C - 0.05) / 0.1))
	return t * t * (3 - 2 * t)
}

// Authored-gray colors shed their tint entirely; authored colors keep it.
const neutralizeChroma = (C: number) => C * colorfulness(C)

const FG_PROPS = new Set([
	'color',
	'text-decoration',
	'text-decoration-color',
	'caret-color',
	'-webkit-text-fill-color',
])

const BG_PROPS = new Set([
	'background',
	'background-color',
	'background-image',
	'box-shadow',
	'text-shadow',
])

const BORDER_PROPS = new Set([
	'border',
	'border-color',
	'border-top',
	'border-right',
	'border-bottom',
	'border-left',
	'border-top-color',
	'border-right-color',
	'border-bottom-color',
	'border-left-color',
	'outline',
	'outline-color',
])

const NAMED_COLORS: Record<string, string> = {
	aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
	azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
	blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
	burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
	coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
	cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
	darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
	darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00',
	darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f',
	darkslateblue: '#483d8b', darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f',
	darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493',
	deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff',
	firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22', fuchsia: '#ff00ff',
	gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520',
	gray: '#808080', green: '#008000', greenyellow: '#adff2f', grey: '#808080',
	honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c', indigo: '#4b0082',
	ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa', lavenderblush: '#fff0f5',
	lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080',
	lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
	lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
	lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899',
	lightslategrey: '#778899', lightsteelblue: '#b0c4de', lightyellow: '#ffffe0',
	lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6', magenta: '#ff00ff',
	maroon: '#800000', mediumaquamarine: '#66cdaa', mediumblue: '#0000cd',
	mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371',
	mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc',
	mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa',
	mistyrose: '#ffe4e1', moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080',
	oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500',
	orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98',
	paleturquoise: '#afeeee', palevioletred: '#db7093', papayawhip: '#ffefd5',
	peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb', plum: '#dda0dd',
	powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399', red: '#ff0000',
	rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072',
	sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d',
	silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd', slategray: '#708090',
	slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f', steelblue: '#4682b4',
	tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347',
	turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff',
	whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
}

// One pass over a declaration value: hex, rgb()/hsl(), and named colors are
// matched together so a replacement can't be re-matched by a later pattern.
const COLOR_TOKEN = new RegExp(
	String.raw`#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\([^)]*\)|\b(?:${Object.keys(NAMED_COLORS).join('|')})\b`,
	'gi',
)

// Declarations inside style attributes and <style> text share this shape.
// Selector colons ("a:hover") resolve to a non-color "property" and pass
// through untouched, so no real CSS parser is needed for email-grade CSS.
const DECLARATION = /([-\w]+)(\s*:\s*)([^;{}]+)/g

type Rgba = { r: number; g: number; b: number; a: number }

export const parseCssColor = (token: string): Rgba | null => {
	const value = token.trim().toLowerCase()
	const named = NAMED_COLORS[value]
	if (named) return parseCssColor(named)

	if (value.startsWith('#')) {
		const hex = value.slice(1)
		if (!/^[0-9a-f]+$/.test(hex)) return null
		if (hex.length === 3 || hex.length === 4) {
			const [r, g, b, a] = hex.split('').map((c) => parseInt(c + c, 16))
			return { r, g, b, a: hex.length === 4 ? a / 255 : 1 }
		}
		if (hex.length === 6 || hex.length === 8) {
			const [r, g, b, a] = [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16))
			return { r, g, b, a: hex.length === 8 ? a / 255 : 1 }
		}
		return null
	}

	const fn = value.match(/^(rgb|hsl)a?\(\s*([^)]*)\)$/)
	if (!fn) return null
	const parts = fn[2].split(/[\s,/]+/).filter(Boolean)
	if (parts.length < 3) return null
	const num = (raw: string, scale: number) =>
		raw.endsWith('%') ? (parseFloat(raw) / 100) * scale : parseFloat(raw)
	const alpha = parts.length > 3 ? num(parts[3], 1) : 1
	if ([...parts.slice(0, 3), parts[3] ?? '0'].some((p) => isNaN(parseFloat(p)))) return null

	if (fn[1] === 'rgb') {
		const [r, g, b] = parts.map((p) => num(p, 255))
		return { r, g, b, a: alpha }
	}
	// hsl(): CSS's own hue-to-rgb, with hue in degrees and s/l as percentages.
	const h = (((parseFloat(parts[0]) % 360) + 360) % 360) / 360
	const s = num(parts[1], 1)
	const l = num(parts[2], 1)
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s
	const p = 2 * l - q
	const channel = (t: number) => {
		t = ((t % 1) + 1) % 1
		if (t < 1 / 6) return p + (q - p) * 6 * t
		if (t < 1 / 2) return q
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
		return p
	}
	return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255, a: alpha }
}

// sRGB ↔ OKLab, per Björn Ottosson's reference implementation.
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

const srgbToOklab = ({ r, g, b }: Rgba) => {
	const [lr, lg, lb] = [r, g, b].map((c) => srgbToLinear(c / 255))
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
	return {
		L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	}
}

const relativeLuminance = ({ r, g, b }: Rgba) => {
	const [lr, lg, lb] = [r, g, b].map((c) => srgbToLinear(c / 255))
	return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

const oklabToSrgb = (L: number, a: number, b: number) => {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	].map(linearToSrgb)
}

const formatRgba = (channels: number[], alpha: number) => {
	const [r, g, b] = channels.map((c) => Math.min(255, Math.max(0, Math.round(c * 255))))
	if (alpha < 1) return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`
	return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
}

/**
 * Remap one color literal for the dark canvas, or null when it should be left
 * exactly as the author wrote it (already dark bg / light fg, unparseable
 * syntax, fully transparent).
 */
export const mapColorToken = (token: string, role: ColorRole): string | null => {
	const rgba = parseCssColor(token)
	if (!rgba || rgba.a === 0) return null

	const { L, a, b } = srgbToOklab(rgba)
	const chroma = Math.hypot(a, b)
	let mappedL: number
	let targetChroma: number
	if (role === 'bg') {
		mappedL = invertBackgroundL(L)
		// Surfaces keep a damped version of whatever tint the author gave them —
		// tint on a large surface is design (a navy status header stays navy).
		// The gray-sheds-its-tint knee is for text only: tinted text on the
		// neutral canvas reads as colored words, a tinted surface just reads as
		// brand. Damping only keeps flipped-light surfaces from going neon.
		targetChroma = Math.min(chroma * 0.85, BG_MAX_CHROMA)
	} else if (role === 'border') {
		// Borders invert like surfaces but are floored at the hairline band,
		// weighted by how visible they were against white — a divider that read
		// in light mode still reads in dark, while a near-white "spacer" border
		// (authored invisible over a white surface) tracks pure inversion and
		// stays invisible over the surface's remapped color.
		// Full floor for anything up to #eee-grade dividers (L ≈ 0.95), fading
		// to none by #fafafa (L ≈ 0.99), where light mode itself showed nothing.
		const visibility = Math.min(1, Math.max(0, (0.99 - L) / 0.04))
		mappedL = Math.max(invertBackgroundL(L), HAIRLINE_L * visibility)
		targetChroma = Math.min(chroma * 0.85, BG_MAX_CHROMA)
	} else {
		// Gray text flips into the light band and sheds its tint. Colorful text
		// keeps its hue and saturation exactly and is only brightened when it
		// lacks AA contrast against the canvas: scaling the whole Lab vector by
		// k scales linear RGB by k³, so the color lands on the luminance floor
		// precisely, hue untouched. The colorfulness knee blends the regimes.
		const t = colorfulness(chroma)
		const grayL = Math.max(L, 0.9 - 0.25 * L)
		const k = Math.max(
			1,
			Math.cbrt(MIN_FG_LUMINANCE / Math.max(relativeLuminance(rgba), 1e-4)),
		)
		const colorL = Math.min(L * k, 0.97)
		mappedL = grayL + (colorL - grayL) * t
		targetChroma = neutralizeChroma(chroma) + (chroma * k - neutralizeChroma(chroma)) * t
	}
	// Identity only when both axes are at a fixed point (in practice: text that
	// is already light and either neutral or saturated) — keep the author's
	// exact bytes then. Epsilon, not equality: conversion leaves ~1e-8 residue.
	if (Math.abs(mappedL - L) < 1e-6 && Math.abs(targetChroma - chroma) < 1e-6) return null
	let scale = chroma > 0 ? targetChroma / chroma : 1
	// The lightened/darkened color can leave sRGB gamut (e.g. saturated blue
	// text pushed light); walk chroma down instead of clamping channels, which
	// would shift the hue.
	for (let i = 0; i < 20; i++) {
		const channels = oklabToSrgb(mappedL, a * scale, b * scale)
		if (channels.every((c) => c >= -0.001 && c <= 1.001)) return formatRgba(channels, rgba.a)
		scale *= 0.85
	}
	return formatRgba(oklabToSrgb(mappedL, 0, 0), rgba.a)
}

// url(...) is masked before token replacement so color words inside image
// paths ("…/white-logo.png") can't be rewritten.
export const remapCssValue = (value: string, role: ColorRole) => {
	const urls: string[] = []
	const masked = value.replace(/url\([^)]*\)/gi, (url) => `url( ${urls.push(url) - 1} )`)
	const mapped = masked.replace(COLOR_TOKEN, (token) => mapColorToken(token, role) ?? token)
	return mapped.replace(/url\( (\d+) \)/g, (_, i) => urls[Number(i)])
}

export const remapCssText = (css: string) =>
	css.replace(DECLARATION, (full, prop: string, sep: string, value: string) => {
		const name = prop.toLowerCase()
		const role = FG_PROPS.has(name)
			? 'fg'
			: BG_PROPS.has(name)
				? 'bg'
				: BORDER_PROPS.has(name)
					? 'border'
					: null
		return role ? prop + sep + remapCssValue(value, role) : full
	})

// Legacy bgcolor/color attributes may omit the leading '#' ("bgcolor=ffffff").
const mapAttrColor = (raw: string, role: ColorRole) => {
	const token = raw.trim()
	if (/^[0-9a-f]{6}$/i.test(token) && !(token.toLowerCase() in NAMED_COLORS))
		return mapColorToken('#' + token, role)
	return mapColorToken(token, role)
}

// ——— Author color-scheme rules ——————————————————————————————————————————————
//
// Emails ship their own `@media (prefers-color-scheme: dark)` rules, and the
// srcdoc iframe inherits the app's scheme, so in dark mode they DO activate.
// They still can't be honored: sanitization strips the attributes their
// selectors key on (Discourse's dm="body"), so the design half-applies — a
// broad `p, td { color: inherit !important }` fires without any of the
// surfaces it assumed, inheriting the light-theme fallback onto a dark canvas.
// They'd also fight the deterministic remap, and their canvas rules fool the
// art-direction check. Normalizing every email to its light-scheme self — the
// one design that is always fully authored — gives the remap one trustworthy
// input.

const PURE_LIGHT_CONDITION =
	/^\s*(?:only\s+)?(?:all|screen)?\s*(?:and\s*)?\(\s*prefers-color-scheme\s*:\s*light\s*\)\s*$/i

export const stripDarkSchemeMedia = (css: string): string => {
	let out = ''
	let i = 0
	while (i < css.length) {
		const at = css.indexOf('@media', i)
		const brace = at === -1 ? -1 : css.indexOf('{', at)
		if (brace === -1) return out + css.slice(i)
		out += css.slice(i, at)
		let depth = 1
		let j = brace + 1
		while (j < css.length && depth > 0) {
			if (css[j] === '{') depth++
			else if (css[j] === '}') depth--
			j++
		}
		const condition = css.slice(at + '@media'.length, brace)
		if (/prefers-color-scheme\s*:\s*dark/i.test(condition) && !/\bnot\b/i.test(condition)) {
			// Dark-only rules: drop the whole block.
		} else if (PURE_LIGHT_CONDITION.test(condition)) {
			// Light-only rules are part of the light design — make them
			// unconditional so the remap sees them even in a dark-scheme iframe.
			out += css.slice(brace + 1, depth === 0 ? j - 1 : j)
		} else {
			out += css.slice(at, j)
		}
		i = j
	}
	return out
}

/** Reduce the email to its light-scheme design, in place. */
export const normalizeToLightScheme = (doc: Document) => {
	doc.querySelectorAll('style').forEach((style) => {
		const media = style.getAttribute('media')
		if (media && /prefers-color-scheme\s*:\s*dark/i.test(media) && !/\bnot\b/i.test(media)) {
			style.remove()
			return
		}
		if (media && PURE_LIGHT_CONDITION.test(media)) style.removeAttribute('media')
		const css = style.textContent ?? ''
		const stripped = stripDarkSchemeMedia(css)
		if (stripped !== css) style.textContent = stripped
	})
}

// ——— Art direction detection ————————————————————————————————————————————————
//
// An email is art-directed when its author both claimed the whole canvas — a
// full-bleed background near the top of the document — and painted with color
// somewhere. Such designs (a navy status page, an indigo campaign) are meant
// to be seen as composed; the caller renders them as authored instead of
// remapping. A full-bleed *white* page alone doesn't qualify — explicit-white
// plain mail still wants darkening — and quoted content can't claim the
// canvas of the reply that wraps it.

const FULL_BLEED_DEPTH = 3

const elementBackground = (el: Element): string | null => {
	const inline = el.getAttribute('style')?.match(/background(?:-color)?\s*:\s*([^;]+)/i)?.[1]
	return inline?.trim() || el.getAttribute('bgcolor')
}

const isFullBleed = (el: Element): boolean => {
	const style = el.getAttribute('style') ?? ''
	// A capped width is a centered card, not a canvas.
	if (/max-width\s*:\s*\d+px/i.test(style)) return false
	const width = el.getAttribute('width') ?? style.match(/(?:^|;)\s*width\s*:\s*([^;]+)/i)?.[1]
	// Tables shrink to their content — they only claim the canvas at an
	// explicit 100%. Divs and friends span it unless the author narrowed them.
	if (el.tagName === 'TABLE') return (width ?? '').trim().startsWith('100%')
	return !width || width.trim().startsWith('100%')
}

// Weight of the visible content an element carries — text plus images (which
// is all the content text-free marketing mail has). The canvas is the surface
// the content sits on: a full-bleed element holding almost none of it (a
// decorative banner strip) is a component, not the canvas.
const contentWeight = (el: Element): number =>
	(el.textContent?.trim().length ?? 0) + el.querySelectorAll('img').length * 100

const isChromaticToken = (token: string): boolean => {
	const rgba = parseCssColor(token)
	if (!rgba || rgba.a === 0) return false
	const { L, a, b } = srgbToOklab(rgba)
	const chroma = Math.hypot(a, b)
	// Absolute chroma for light/mid colors; relative for dark ones, where
	// OKLab compresses chroma (a saturated navy sits near C 0.045).
	return chroma >= 0.05 || chroma / Math.max(L, 0.05) >= 0.15
}

const BODY_BACKGROUND_RULE = /(?:^|[\s,{}])(?:body|html)\b[^{]*\{[^}]*background/i

export const isArtDirected = (doc: Document): boolean => {
	// Quoted content speaks only for itself, never for the reply wrapping it —
	// its style sheets can't claim the canvas and its colors don't make the
	// reply "painted" (the BFS below skips quoted subtrees for the same reason).
	const isQuoted = (el: Element) => !!el.closest('.gmail_quote, .frappe_mail_quote, blockquote')
	const sheets = Array.from(doc.querySelectorAll('style'))
		.filter((style) => !isQuoted(style))
		.map((s) => s.textContent ?? '')

	let claimsCanvas = sheets.some((css) => BODY_BACKGROUND_RULE.test(css))
	const bodyWeight = contentWeight(doc.body)
	const queue: Array<[Element, number]> = [[doc.body, 0]]
	while (!claimsCanvas && queue.length) {
		const [el, depth] = queue.shift()!
		if (el.matches('.gmail_quote, .frappe_mail_quote, blockquote')) continue
		if (elementBackground(el) && isFullBleed(el) && contentWeight(el) >= bodyWeight * 0.5)
			claimsCanvas = true
		else if (depth < FULL_BLEED_DEPTH)
			for (const child of Array.from(el.children)) queue.push([child, depth + 1])
	}
	if (!claimsCanvas) return false

	// Painted with color anywhere? (The canvas itself may be the colorful part.)
	const values: string[] = []
	doc.querySelectorAll('[bgcolor], [style]').forEach((el) => {
		if (isQuoted(el)) return
		const bg = elementBackground(el)
		if (bg) values.push(bg)
	})
	for (const css of sheets)
		for (const rule of css.matchAll(/background(?:-color)?\s*:\s*([^;}]+)/gi)) values.push(rule[1])
	return values.some((value) => {
		const tokens =
			value.match(COLOR_TOKEN) ?? (/^[0-9a-f]{6}$/i.test(value.trim()) ? ['#' + value.trim()] : [])
		return tokens.some(isChromaticToken)
	})
}

const elementTextColor = (el: Element): string | null => {
	const inline = el.getAttribute('style')?.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]
	return inline?.trim() || el.getAttribute('color')
}

// A surface painted by url(...) — a raster the remap cannot rewrite (the token
// pass masks url() precisely so it never touches one). Its pixels are
// byte-identical in dark mode, so the text resting on it must be too:
// remapping dark text over a light gradient JPEG flips it near-white and it
// vanishes into the image. CSS gradients don't count — they carry color
// literals and are remapped like any other surface. Requires a non-empty
// url(): blocked remote assets are blanked to url() and paint nothing.
const hasImageBackground = (el: Element): boolean =>
	/background[^;:]*:[^;]*url\(\s*[^)\s]/i.test(el.getAttribute('style') ?? '')

// Surfaces whose background is authored in <style> sheets rather than inline
// (Twilio's white card is a classed rule; some heroes class their bg image).
// The walk below must stop at them too: missing a sheet-backed card between
// the text and a textured wrapper pins the text to a surface it doesn't rest
// on. Selectors are resolved with querySelectorAll — rules inside @media are
// treated as unconditional, which is exact for the surviving light-scheme
// rules (dark blocks are stripped before remapping) and a fair approximation
// for responsive ones.
type SheetSurfaces = { color: Set<Element>; image: Set<Element> }

const collectSheetSurfaces = (doc: Document): SheetSurfaces => {
	const surfaces: SheetSurfaces = { color: new Set(), image: new Set() }
	doc.querySelectorAll('style').forEach((style) => {
		for (const rule of (style.textContent ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			const values = [...rule[2].matchAll(/background(?:-color|-image)?\s*:\s*([^;]+)/gi)]
			if (!values.length) continue
			const isImage = values.some((v) => /url\(\s*[^)\s]/i.test(v[1]))
			const isColor = values.some((v) => {
				const token = v[1].match(COLOR_TOKEN)?.[0]
				return !!token && (parseCssColor(token)?.a ?? 0) > 0
			})
			if (!isImage && !isColor) continue
			const selector = rule[1].trim()
			if (selector.startsWith('@')) continue
			try {
				doc.querySelectorAll(selector).forEach((el) => {
					;(isImage ? surfaces.image : surfaces.color).add(el)
				})
			} catch {
				/* selector syntax we can't resolve — skip */
			}
		}
	})
	return surfaces
}

// An image layer paints over any color layer, wherever each is declared.
const isImageSurface = (el: Element, sheets: SheetSurfaces): boolean =>
	hasImageBackground(el) || sheets.image.has(el)

// The innermost element whose background the text actually rests on — the one
// that decides whether its text follows the remap (color surface) or the
// authored bytes (image surface). A color-backed card nested inside a hero
// image is its own surface: its text keeps following the remap.
const nearestSurface = (el: Element, sheets: SheetSurfaces): Element | null => {
	let cur: Element | null = el
	while (
		cur &&
		!elementBackground(cur) &&
		!isImageSurface(cur, sheets) &&
		!sheets.color.has(cur)
	)
		cur = cur.parentElement
	return cur
}

const parseAnyColor = (raw: string | null): Rgba | null => {
	if (!raw) return null
	const token = raw.trim()
	if (/^[0-9a-f]{6}$/i.test(token) && !(token.toLowerCase() in NAMED_COLORS))
		return parseCssColor('#' + token)
	return parseCssColor(token)
}

/** Remap every color literal in the (already sanitized) email document, in place. */
export const remapEmailForDarkMode = (doc: Document) => {
	// Camouflaged text — authored in exactly the color of the surface beneath it
	// (hidden preheaders, spam-filter padding) — is meant to be invisible.
	// Snapshot those pairs before remapping: afterwards the text is re-pinned to
	// its surface's mapped color, so it follows the background mapping instead
	// of the text mapping and dark mode doesn't reveal what light mode hides.
	const sheets = collectSheetSurfaces(doc)

	const camouflaged: Array<{ el: Element; surface: Element }> = []
	doc.querySelectorAll('[style], [color]').forEach((el) => {
		const fg = parseAnyColor(elementTextColor(el))
		if (!fg || fg.a !== 1) return
		const surface = nearestSurface(el, sheets)
		// Text over an image surface is pinned to its authored bytes below —
		// matching a color further up the tree there is coincidence, not intent.
		if (surface && isImageSurface(surface, sheets)) return
		const bg = surface && parseAnyColor(elementBackground(surface))
		if (!surface || !bg || bg.a !== 1) return
		if (
			Math.round(fg.r) === Math.round(bg.r) &&
			Math.round(fg.g) === Math.round(bg.g) &&
			Math.round(fg.b) === Math.round(bg.b)
		)
			camouflaged.push({ el, surface })
	})

	// Snapshot text resting on image surfaces before remapping, to re-pin its
	// authored color afterwards. Two shapes: text with its own color literal,
	// and image surfaces whose text inherits from above — the ancestor literal
	// gets remapped light, so the surface needs an explicit copy of the color
	// it inherited when authored (default black: an author relying on the UA
	// default designed against a light image).
	const pinned: Array<{ el: Element; color: string }> = []
	doc.querySelectorAll('[style], [color]').forEach((el) => {
		const authored = elementTextColor(el)
		if (!authored) return
		const surface = nearestSurface(el, sheets)
		if (surface && isImageSurface(surface, sheets)) pinned.push({ el, color: authored })
	})
	const imageSurfaces = new Set<Element>(sheets.image)
	doc.querySelectorAll('[style]').forEach((el) => {
		if (hasImageBackground(el)) imageSurfaces.add(el)
	})
	imageSurfaces.forEach((el) => {
		if (elementTextColor(el)) return
		let cur = el.parentElement
		while (cur && !elementTextColor(cur)) cur = cur.parentElement
		pinned.push({ el, color: (cur && elementTextColor(cur)) || '#000000' })
	})

	doc.querySelectorAll('style').forEach((style) => {
		style.textContent = remapCssText(style.textContent ?? '')
	})
	doc.querySelectorAll('[style], [bgcolor], [color]').forEach((el) => {
		const style = el.getAttribute('style')
		if (style) el.setAttribute('style', remapCssText(style))
		const bgcolor = el.getAttribute('bgcolor')
		const mappedBg = bgcolor && mapAttrColor(bgcolor, 'bg')
		if (mappedBg) el.setAttribute('bgcolor', mappedBg)
		const color = el.getAttribute('color')
		const mappedColor = color && mapAttrColor(color, 'fg')
		if (mappedColor) el.setAttribute('color', mappedColor)
	})

	camouflaged.forEach(({ el, surface }) => {
		const surfaceColor = elementBackground(surface)
		// A surface that didn't survive as a plain color (e.g. a shorthand with
		// url()) was never matched, so this always parses; still, guard.
		if (!surfaceColor || !parseAnyColor(surfaceColor)) return
		const style = el.getAttribute('style')
		if (style && /(?:^|;)\s*color\s*:/i.test(style))
			el.setAttribute('style', style.replace(/((?:^|;)\s*color\s*:\s*)[^;]+/i, `$1${surfaceColor}`))
		else if (el.getAttribute('color')) el.setAttribute('color', surfaceColor)
	})

	// Never overlaps with the camouflage pass: nearestSurface is deterministic,
	// and camouflage skips image surfaces while pinning requires one.
	pinned.forEach(({ el, color }) => {
		const style = el.getAttribute('style')
		if (style && /(?:^|;)\s*color\s*:/i.test(style))
			el.setAttribute('style', style.replace(/((?:^|;)\s*color\s*:\s*)[^;]+/i, `$1${color}`))
		else if (el.getAttribute('color')) el.setAttribute('color', color)
		else el.setAttribute('style', `${style ? style.replace(/;?\s*$/, ';') : ''}color:${color}`)
	})
}
