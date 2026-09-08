// Numeric series detector — linear arithmetic progressions.
//
// Returns a series when every source cell parses as a number AND consecutive
// differences are constant.  A single number falls through (no progression to
// extend) so the caller can default to copy mode unless the user opts into
// "force series" with a modifier key.

export const numericDetector = {
	detect(values) {
		const nums = _asNumbers(values)
		if (!nums) return null
		if (nums.length < 2) return null
		const step = _detectStep(nums)
		if (step === null) return null
		const anchor = nums[nums.length - 1]   // forward anchor = last value
		const anchor0 = nums[0]                // backward anchor = first value
		return {
			kind: 'numeric',
			confidence: 0.85,
			next(offset, dir = 1) {
				const a = dir > 0 ? anchor : anchor0
				return a + dir * offset * step
			},
		}
	},
}

// Shared with the numeric cross-axis fill helpers in fill-series.js.
export function _detectStep(nums) {
	if (nums.length < 2) return null
	const step = nums[1] - nums[0]
	for (let i = 2; i < nums.length; i++) {
		// Floating-point tolerance — 1.5, 2.0, 2.5 must read as step=0.5 even
		// when subtraction drifts in the last bit (e.g. 2.5 - 2.0 = 0.4999...).
		if (Math.abs((nums[i] - nums[i - 1]) - step) > 1e-9) return null
	}
	return step
}

export function _asNumbers(vals) {
	if (!vals.every(v => v !== null && v !== '' && !isNaN(Number(v)))) return null
	return vals.map(Number)
}
