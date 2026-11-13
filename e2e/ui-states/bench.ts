import { execFile } from "node:child_process";
import { connect } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect } from "@playwright/test";

const POLL_MS = 200;
const BACK_TIMEOUT_MS = 120_000;
const ATTEMPTS = 3;
/** What a request says when it reached the port while the bench was away. */
const CONNECTION_LOST = /ECONNREFUSED|ECONNRESET|socket hang up/;

interface BenchWatch {
	/** Runs one walk, and runs it again if the bench went away while it ran. */
	survive(walk: () => Promise<void>): Promise<void>;
	stop(): void;
}

/**
 * The dev bench re-execs its runner after 5000 requests, and its port refuses
 * connections until the new process listens. A full capture crosses that
 * limit, so a failure while the port was refusing is the bench's restart, not
 * the flow's. Any other failure still fails the run.
 */
export function watchBench(baseURL: string): BenchWatch {
	let refusedAt = 0;
	const poll = async () => {
		if (!(await isListening(baseURL))) refusedAt = Date.now();
	};
	const timer = setInterval(() => void poll(), POLL_MS);

	return {
		async survive(walk) {
			for (let attempt = 1; ; attempt++) {
				const startedAt = Date.now();
				try {
					await walk();
					return;
				} catch (error) {
					await poll();
					if (refusedAt < startedAt || attempt === ATTEMPTS) throw error;
					console.log(`The bench restarted during a path; walking it again (attempt ${attempt + 1}).`);
					await untilListening(baseURL);
				}
			}
		},
		stop: () => clearInterval(timer),
	};
}

/**
 * Runs `work`, and runs it again once the bench listens if it failed because
 * the bench was away. For cleanups, which must finish even when a restart
 * cut their path short.
 */
export async function acrossRestarts<T>(baseURL: string, work: () => Promise<T>): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await work();
		} catch (error) {
			const away = CONNECTION_LOST.test(String(error)) || !(await isListening(baseURL));
			if (!away || attempt === ATTEMPTS) throw error;
			await untilListening(baseURL);
		}
	}
}

async function untilListening(baseURL: string): Promise<void> {
	await expect.poll(() => isListening(baseURL), { timeout: BACK_TIMEOUT_MS }).toBe(true);
}

function isListening(baseURL: string): Promise<boolean> {
	const { hostname, port, protocol } = new URL(baseURL);
	return new Promise<boolean>((done) => {
		const socket = connect({ host: hostname, port: Number(port || (protocol === "https:" ? 443 : 80)) });
		socket.once("connect", () => {
			socket.destroy();
			done(true);
		});
		socket.once("error", () => done(false));
	});
}

/** Sets one key in a site's `site_config.json` on the bench at `E2E_BENCH_PATH`, as `bench set-config --parse` does. */
export async function setSiteConfig(site: string, key: string, value: number): Promise<void> {
	const benchPath = process.env.E2E_BENCH_PATH;
	if (!benchPath) throw new Error("E2E_BENCH_PATH must name the bench that serves the sites");
	const python = resolve(benchPath, "env/bin/python");
	const args = ["-m", "frappe.utils.bench_helper", "frappe", "--site", site, "set-config", key, String(value), "--parse"];
	await promisify(execFile)(python, args, { cwd: resolve(benchPath, "sites") });
}
