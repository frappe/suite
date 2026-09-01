export const firstCaptureStartedAt = (
	current: number | null,
	timestamp: string,
): number => current ?? Date.parse(timestamp);
