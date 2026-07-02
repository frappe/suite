const DIAGNOSTICS_KEY = "__meetDiagnosticsConsoleBuffer";
const DEFAULT_MAX_ENTRIES = 300;
const MAX_ARG_CHARS = 240;
const MAX_LINE_CHARS = 600;

type LogLevel = "log" | "info" | "warn" | "error" | "debug";

interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
}

interface DiagnosticsStore {
	entries: LogEntry[];
	maxEntries: number;
	installed: boolean;
}

interface ConsoleLogSummary {
	total: number;
	log: number;
	info: number;
	warn: number;
	error: number;
	debug: number;
}

interface InstallConsoleBufferOptions {
	maxEntries?: number;
}

declare global {
	interface Window {
		[DIAGNOSTICS_KEY]: DiagnosticsStore;
	}
}

function ensureStore(
	maxEntries: number = DEFAULT_MAX_ENTRIES,
): DiagnosticsStore {
	if (!window[DIAGNOSTICS_KEY]) {
		window[DIAGNOSTICS_KEY] = {
			entries: [],
			maxEntries,
			installed: false,
		};
	}

	const store = window[DIAGNOSTICS_KEY];
	if (Number.isFinite(maxEntries) && maxEntries > 0) {
		store.maxEntries = maxEntries;
	}
	return store;
}

function toShortString(value: unknown): string {
	if (value instanceof Error) {
		return `${value.name}: ${value.message}`;
	}

	if (typeof value === "string") {
		return value.length > MAX_ARG_CHARS
			? `${value.slice(0, MAX_ARG_CHARS)}...`
			: value;
	}

	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null ||
		value === undefined
	) {
		return String(value);
	}

	try {
		const serialized = JSON.stringify(value);
		if (!serialized) return String(value);
		return serialized.length > MAX_ARG_CHARS
			? `${serialized.slice(0, MAX_ARG_CHARS)}...`
			: serialized;
	} catch (_error) {
		return Object.prototype.toString.call(value);
	}
}

function appendEntry(level: LogLevel, args: unknown[]): void {
	const store = ensureStore();
	const timestamp = new Date().toISOString();
	const rendered = args.map((arg) => toShortString(arg)).join(" ");
	const message =
		rendered.length > MAX_LINE_CHARS
			? `${rendered.slice(0, MAX_LINE_CHARS)}...`
			: rendered;

	store.entries.push({ timestamp, level, message });

	if (store.entries.length > store.maxEntries) {
		store.entries.splice(0, store.entries.length - store.maxEntries);
	}
}

export function installConsoleBuffer(
	options: InstallConsoleBufferOptions = {},
): void {
	const store = ensureStore(options.maxEntries ?? DEFAULT_MAX_ENTRIES);
	if (store.installed) return;

	const levels: LogLevel[] = ["log", "info", "warn", "error", "debug"];
	for (const level of levels) {
		const original = console[level].bind(console) as (
			...args: unknown[]
		) => void;
		console[level] = (...args: unknown[]) => {
			appendEntry(level, args);
			original(...args);
		};
	}

	window.addEventListener("error", (event: ErrorEvent) => {
		appendEntry("error", [
			"window.error",
			event.message || "Unknown window error",
			event.filename || "",
			event.lineno || "",
		]);
	});

	window.addEventListener(
		"unhandledrejection",
		(event: PromiseRejectionEvent) => {
			appendEntry("error", ["unhandledrejection", toShortString(event.reason)]);
		},
	);

	store.installed = true;
}

export function getConsoleLogLines(limit = 60): string[] {
	const store = ensureStore();
	const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 60;
	const recent = store.entries.slice(-safeLimit);
	return recent.map((entry) => {
		const shortTs = entry.timestamp.slice(11, 19);
		return `[${shortTs}] ${entry.level.toUpperCase()} ${entry.message}`;
	});
}

export function getConsoleLogSummary(): ConsoleLogSummary {
	const store = ensureStore();
	const summary: ConsoleLogSummary = {
		total: store.entries.length,
		log: 0,
		info: 0,
		warn: 0,
		error: 0,
		debug: 0,
	};

	for (const entry of store.entries) {
		summary[entry.level] += 1;
	}

	return summary;
}
