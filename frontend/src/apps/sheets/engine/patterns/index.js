// Pattern detection pipeline for drag-fill.
//
// Each detector takes the source values (raw strings) and returns either:
//
//   {
//     kind:       'numeric' | 'date' | 'named-sequence' | ...,
//     confidence: 0..1,
//     next(offset, dir):  returns the value at `offset` cells past the source
//                         when extending in direction `dir` (+1 = forward,
//                         -1 = backward).  offset = 1 means the cell
//                         immediately after the source.
//   }
//
// ...or null when the detector doesn't recognise the input.
//
// detectSeries() runs detectors in priority order and returns the first
// match.  Higher-specificity detectors come first — a "Mon, Tue" sequence
// must be caught by the named-sequence detector before falling through to
// "any text → copy".

import { numericDetector }        from './numeric.js'
import { dateDetector }           from './date.js'
import { namedSequenceDetector }  from './named-sequence.js'
import { timeDetector }           from './time.js'
import { textNumberDetector }     from './text-number.js'
import { alphabeticDetector }     from './alphabetic.js'

// Priority order — most specific first.  Date and time match strict regex
// shapes so they never steal generic cases.  Named-sequence handles calendar
// wrap-around.  Text-with-numbers tokenises around embedded ints.  Alphabetic
// matches pure-letter sequences.  Numeric is the last resort before copy.
const DETECTORS = [
	dateDetector,
	timeDetector,
	namedSequenceDetector,
	textNumberDetector,
	alphabeticDetector,
	numericDetector,
]

export function detectSeries(values) {
	for (const det of DETECTORS) {
		const result = det.detect(values)
		if (result) return result
	}
	return null
}
