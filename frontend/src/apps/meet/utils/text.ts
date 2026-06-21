export function getInitials(name: string, fallback = "Y"): string {
	const trimmed = name.trim();
	if (!trimmed) return fallback;

	return trimmed.charAt(0).toUpperCase();
}
