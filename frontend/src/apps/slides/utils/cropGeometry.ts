// pure crop geometry. a crop is fractions of the natural image, absent when
// uncropped. local unrotated space only; rotation and flip are the caller's job.

export interface CropRect {
	x: number
	y: number
	width: number
	height: number
}

export interface Size {
	width: number
	height: number
}

export interface Point {
	x: number
	y: number
}

const FULL_RECT: CropRect = { x: 0, y: 0, width: 1, height: 1 }

// with a tolerance: clamping at an image edge can leave float dust, and a
// near-full crop must still count as the canonical absent state
export const isFullRect = (crop: CropRect) =>
	Math.abs(crop.x) < 1e-9 &&
	Math.abs(crop.y) < 1e-9 &&
	Math.abs(crop.width - 1) < 1e-9 &&
	Math.abs(crop.height - 1) < 1e-9

// the crop maps to the content box: a border on the mask insets the frame
export const getBorderInset = (element: { borderStyle?: string; borderWidth?: number }) => {
	if (!element.borderStyle || element.borderStyle == 'none') return 0
	return element.borderWidth || 0
}

const isUsableAspect = (aspect: number) => Number.isFinite(aspect) && aspect > 0

// the centred rect an object-cover render shows: the axis where the image
// overbleeds the frame is trimmed equally on both sides
export const getCoverCrop = (naturalAspect: number, frameAspect: number): CropRect => {
	// a dimensionless SVG probes as NaN (0/0), which must not become a crop
	if (!isUsableAspect(naturalAspect) || !isUsableAspect(frameAspect)) return { ...FULL_RECT }
	if (naturalAspect > frameAspect) {
		const width = frameAspect / naturalAspect
		return { x: (1 - width) / 2, y: 0, width, height: 1 }
	}
	const height = naturalAspect / frameAspect
	return { x: 0, y: (1 - height) / 2, width: 1, height }
}

// the box the full image must occupy so exactly the crop rect shows through
// the frame. unit-agnostic: the result is in whatever units `frame` uses
export const getCroppedImageBox = (crop: CropRect | null | undefined, frame: Size) => {
	const { x, y, width, height } = crop ?? FULL_RECT

	const imgWidth = frame.width / width
	const imgHeight = frame.height / height

	// || 0 turns -0 into 0
	return {
		left: -x * imgWidth || 0,
		top: -y * imgHeight || 0,
		width: imgWidth,
		height: imgHeight,
	}
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

// pan the image behind the frame: the crop rect slides the opposite way,
// clamped to the image edges. the size never changes, which preserves aspect
export const panCrop = (crop: CropRect, localDelta: Point, frame: Size): CropRect => {
	const { x, y, width, height } = crop

	return {
		x: clamp(x - (localDelta.x * width) / frame.width, 0, 1 - width),
		y: clamp(y - (localDelta.y * height) / frame.height, 0, 1 - height),
		width,
		height,
	}
}

// per axis: -1 grabs the low edge (left/top), 1 the high edge, 0 leaves the axis alone
const GRAB_SIGN: Record<string, Point> = {
	left: { x: -1, y: 0 },
	right: { x: 1, y: 0 },
	top: { x: 0, y: -1 },
	bottom: { x: 0, y: 1 },
	'top-left': { x: -1, y: -1 },
	'top-right': { x: 1, y: -1 },
	'bottom-left': { x: -1, y: 1 },
	'bottom-right': { x: 1, y: 1 },
}

const dragCropEdge = (
	offset: number,
	size: number,
	frameSize: number,
	grab: number,
	delta: number,
	minFrame: number,
) => {
	if (!grab) return { offset, size, delta: 0 }

	// the image never scales, so crop and frame trade edges at this fixed rate
	const imageSize = frameSize / size
	const shrinkLimit = Math.max(0, frameSize - minFrame)

	if (grab < 0) {
		// low edge: +delta drags inward, -delta stops at the image's low edge
		const clamped = clamp(delta, Math.min(0, -offset * imageSize), shrinkLimit)
		return { offset: offset + clamped / imageSize, size: size - clamped / imageSize, delta: clamped }
	}

	// high edge: -delta drags inward, +delta stops at the image's high edge
	const clamped = clamp(delta, -shrinkLimit, Math.max(0, (1 - offset - size) * imageSize))
	return { offset, size: size + clamped / imageSize, delta: clamped }
}

// owns every clamp; the caller must move the frame by the returned delta verbatim, or the content shifts
export const resizeCrop = (
	crop: CropRect,
	frame: Size,
	handle: string,
	localEdgeDelta: Point,
	minFrame: Size,
): { crop: CropRect; localEdgeDelta: Point } => {
	const grab = GRAB_SIGN[handle]

	const xAxis = dragCropEdge(crop.x, crop.width, frame.width, grab.x, localEdgeDelta.x, minFrame.width)
	const yAxis = dragCropEdge(crop.y, crop.height, frame.height, grab.y, localEdgeDelta.y, minFrame.height)

	return {
		crop: { x: xAxis.offset, y: yAxis.offset, width: xAxis.size, height: yAxis.size },
		localEdgeDelta: { x: xAxis.delta, y: yAxis.delta },
	}
}
