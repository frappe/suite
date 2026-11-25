export function applyFixturePatches(source, patches) {
	for (const [anchor, replacement] of patches) {
		const first = source.indexOf(anchor);
		if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) {
			throw new Error(
				`Network fixture expected one occurrence of ${JSON.stringify(anchor)}`,
			);
		}
		source =
			source.slice(0, first) +
			replacement +
			source.slice(first + anchor.length);
	}
	return source;
}
