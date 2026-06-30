export function getInitials(name: string, fallback = ""): string {
	const trimmed = name.trim();
	if (!trimmed) return fallback;

	return trimmed
		.split(/\s+/)
		.map((part) => part.charAt(0).toUpperCase())
		.slice(0, 2)
		.join("");
}
