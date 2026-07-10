type AvatarTheme = "blue" | "green" | "amber" | "red" | "violet";

const avatarThemes: AvatarTheme[] = ["blue", "green", "amber", "red", "violet"];

export function getAvatarTheme(label?: string | null): AvatarTheme {
	const value = label || "";
	let hash = 0;

	for (let i = 0; i < value.length; i++) {
		hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
	}

	return avatarThemes[hash % avatarThemes.length];
}
