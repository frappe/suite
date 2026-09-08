// Time pattern detector — `HH:MM`, `HH:MM:SS`, optional AM/PM suffix.
//
// Parses each cell to a count-of-seconds, classifies the step granularity
// (seconds / minutes / hours), and stamps the source's shape back on the
// output so "9:00 AM, 10:00 AM" produces "11:00 AM" rather than "11:00".

const _PAD2 = n => String(n).padStart(2, '0')

// Captures groups: 1=hour, 2=min, 3=sec (optional), 4=suffix (am/pm, optional).
const RX = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?$/

function _parse(s) {
	const m = String(s).match(RX)
	if (!m) return null
	let h = +m[1]
	const min = +m[2]
	const sec = m[3] !== undefined ? +m[3] : null
	const sufRaw = m[4] || null
	const suf = sufRaw ? sufRaw.toUpperCase() : null
	if (suf === 'PM' && h < 12) h += 12
	if (suf === 'AM' && h === 12) h = 0
	return {
		seconds: h * 3600 + min * 60 + (sec || 0),
		hasSec:  sec !== null,
		suffix:  suf,
		// Track whether the source AM/PM marker was lowercase so we can
		// echo it back.  "pm" stays "pm", "PM" stays "PM".
		suffixLower: sufRaw ? sufRaw[0] === sufRaw[0].toLowerCase() : false,
		// 24-hour padding: source had 2 digits → pad (so "09:00" → "10:00",
		// "23:00" → "00:00" on wrap).  12-hour mode never pads — the hour
		// renders naturally (1-12).
		padHour: m[1].length === 2,
	}
}

function _format(seconds, ctx) {
	// Normalise to a 24h day so day-overflow wraps naturally.
	seconds = ((seconds % 86400) + 86400) % 86400
	let h = Math.floor(seconds / 3600)
	const min = Math.floor((seconds % 3600) / 60)
	const sec = seconds % 60
	let suffix = ''
	if (ctx.suffix) {
		const pm = h >= 12
		const h12 = h % 12 === 0 ? 12 : h % 12
		h = h12
		suffix = ' ' + (pm
			? (ctx.suffixLower ? 'pm' : 'PM')
			: (ctx.suffixLower ? 'am' : 'AM'))
	}
	// 12-hour rendering never zero-pads the hour (1:00 PM, not 01:00 PM).
	// 24-hour rendering pads only when the source did.
	const hh = (!ctx.suffix && ctx.padHour) ? _PAD2(h) : String(h)
	const out = ctx.hasSec
		? `${hh}:${_PAD2(min)}:${_PAD2(sec)}`
		: `${hh}:${_PAD2(min)}`
	return out + suffix
}

function _classifyStep(times) {
	if (times.length === 1) return { step: 60 }   // single → +1 minute (Google default)
	const diffs = []
	for (let i = 1; i < times.length; i++) {
		diffs.push(times[i].seconds - times[i - 1].seconds)
	}
	if (!diffs.every(d => d === diffs[0])) return null
	if (diffs[0] === 0) return null
	return { step: diffs[0] }
}

export const timeDetector = {
	detect(values) {
		const times = values.map(_parse)
		if (times.some(t => t === null)) return null
		const cls = _classifyStep(times)
		if (!cls) return null
		const anchorFwd  = times[times.length - 1]
		const anchorBack = times[0]
		return {
			kind: 'time',
			confidence: 0.92,
			next(offset, dir = 1) {
				const a = dir > 0 ? anchorFwd : anchorBack
				return _format(a.seconds + dir * offset * cls.step, a)
			},
		}
	},
}
