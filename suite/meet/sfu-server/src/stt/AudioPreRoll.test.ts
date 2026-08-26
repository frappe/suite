import { describe, expect, it } from 'vitest';
import { AudioPreRoll } from './AudioPreRoll';

describe('AudioPreRoll', () => {
	it('retains only the frames immediately before speech begins', () => {
		const preRoll = new AudioPreRoll(3);
		for (let value = 1; value <= 5; value++) {
			preRoll.remember(Buffer.from([value]));
		}

		expect(preRoll.drain()).toEqual([
			Buffer.from([3]),
			Buffer.from([4]),
			Buffer.from([5]),
		]);
		expect(preRoll.drain()).toEqual([]);
	});
});
