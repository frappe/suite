import tinycolor from 'tinycolor2'

// colors saved before hex normalization lack the leading '#' and render as invalid CSS
export const normalizeColor = (colorString) => {
	if (!colorString || typeof colorString !== 'string' || colorString.startsWith('#'))
		return colorString
	const parsed = tinycolor(colorString)
	return parsed.isValid() ? parsed.toHex8String() : colorString
}

export const isBackgroundColorDark = (colorString = '#ffffff') => {
	if (!colorString) colorString = '#ffffff'
	const rgb = colorString.replace('#', '')

	const r = parseInt(rgb.slice(0, 2), 16)
	const g = parseInt(rgb.slice(2, 4), 16)
	const b = parseInt(rgb.slice(4, 6), 16)

	const luminance = 0.2989 * r + 0.587 * g + 0.114 * b
	return luminance < 128
}

export const guessTextColorFromBackground = (colorString) => {
	const textColor = isBackgroundColorDark(colorString) ? '#ffffff' : '#000000'
	return textColor
}

export const guessShapeColorsFromBackground = (colorString) => {
	return isBackgroundColorDark(colorString)
		? { fillColor: '#323232FF', strokeColor: '#F5F5F5FF' }
		: { fillColor: '#EEEEEEFF', strokeColor: '#595959FF' }
}

// grid lines read as a tint of the text color, which already tracks the slide
// background, so they stay visible on a white slide and on a near-black one
export const getDefaultGridColor = (textColor) =>
	tinycolor(textColor || '#000000')
		.setAlpha(0.35)
		.toHex8String()

// bands sit under the header tint so they take less of the same color, and near-black
// needs more of it for the same reason the header does
export const getDefaultBandColor = (textColor) => {
	const color = textColor || '#000000'
	return tinycolor(color)
		.setAlpha(isBackgroundColorDark(color) ? 0.04 : 0.1)
		.toHex8String()
}

export const getColorAndOpacity = (colorString = '#000000ff') => {
	if (!colorString?.startsWith('#') || colorString.length !== 9) {
		return {
			color: colorString,
			opacity: 1,
		}
	}

	return {
		color: colorString.slice(0, 7),
		opacity: parseInt(colorString.slice(7, 9), 16) / 255,
	}
}
