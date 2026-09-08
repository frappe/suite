function setItem(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Browser storage is best-effort and may be unavailable or full.
	}
}

/** Read a boolean stored as "1" or "0", falling back only when the key is absent. */
export function readBoolean(key: string, fallback = false): boolean {
	const value = localStorage.getItem(key);
	return value === null ? fallback : value === "1";
}

/** Store a boolean using the shared "1" or "0" encoding. */
export function writeBoolean(key: string, value: boolean): void {
	setItem(key, value ? "1" : "0");
}

/** Read a string, falling back only when the key is absent. */
export function readString(key: string, fallback = ""): string {
	return localStorage.getItem(key) ?? fallback;
}

/** Store a string without additional encoding. */
export function writeString(key: string, value: string): void {
	setItem(key, value);
}

/** Parse a JSON value, returning null for an absent key and propagating parse errors. */
export function readJSON(key: string): unknown | null {
	const value = localStorage.getItem(key);
	return value === null ? null : (JSON.parse(value) as unknown);
}

/** Serialize and store a JSON value, propagating serialization errors. */
export function writeJSON(key: string, value: unknown): void {
	setItem(key, JSON.stringify(value));
}

/** Remove a stored value. */
export function remove(key: string): void {
	try {
		localStorage.removeItem(key);
	} catch {
		// Browser storage is best-effort and may be unavailable.
	}
}
