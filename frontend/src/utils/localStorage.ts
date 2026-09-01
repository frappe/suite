export function readBoolean(key: string, fallback = false): boolean {
	const value = localStorage.getItem(key);
	return value === null ? fallback : value === "1";
}

export function writeBoolean(key: string, value: boolean): void {
	localStorage.setItem(key, value ? "1" : "0");
}

export function readString(key: string, fallback = ""): string {
	return localStorage.getItem(key) ?? fallback;
}

export function writeString(key: string, value: string): void {
	localStorage.setItem(key, value);
}

export function readJSON(key: string): unknown | null {
	const value = localStorage.getItem(key);
	return value === null ? null : (JSON.parse(value) as unknown);
}

export function writeJSON(key: string, value: unknown): void {
	localStorage.setItem(key, JSON.stringify(value));
}

export function remove(key: string): void {
	localStorage.removeItem(key);
}
