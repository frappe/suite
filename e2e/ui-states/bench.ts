import { connect } from "node:net";
import { expect } from "@playwright/test";

const POLL_MS = 200;
const BACK_TIMEOUT_MS = 120_000;
const ATTEMPTS = 3;

export interface BenchWatch {
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
	const { hostname, port, protocol } = new URL(baseURL);
	const listeningPort = Number(port || (protocol === "https:" ? 443 : 80));
	let refusedAt = 0;

	const isListening = () =>
		new Promise<boolean>((done) => {
			const socket = connect({ host: hostname, port: listeningPort });
			socket.once("connect", () => {
				socket.destroy();
				done(true);
			});
			socket.once("error", () => done(false));
		});
	const poll = async () => {
		if (!(await isListening())) refusedAt = Date.now();
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
					await expect.poll(isListening, { timeout: BACK_TIMEOUT_MS }).toBe(true);
				}
			}
		},
		stop: () => clearInterval(timer),
	};
}
