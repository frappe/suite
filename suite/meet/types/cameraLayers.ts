/** Publisher instructions are scoped to one publication, not a participant. */
export interface CameraLayerDemand {
	producerId: string;
	version: number;
	maxSpatialLayer: number;
}

export function parseCameraLayerDemand(
	value: unknown,
): CameraLayerDemand | null {
	if (!value || typeof value !== 'object') return null;
	if (
		!('producerId' in value) ||
		!('version' in value) ||
		!('maxSpatialLayer' in value)
	)
		return null;
	const data = value;
	if (
		typeof data.producerId !== 'string' ||
		!data.producerId ||
		!Number.isSafeInteger(data.version) ||
		Number(data.version) < 1 ||
		!Number.isSafeInteger(data.maxSpatialLayer) ||
		Number(data.maxSpatialLayer) < 0
	)
		return null;
	return {
		producerId: data.producerId,
		version: Number(data.version),
		maxSpatialLayer: Number(data.maxSpatialLayer),
	};
}
