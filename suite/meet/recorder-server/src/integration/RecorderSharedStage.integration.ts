import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { io, type Socket } from 'socket.io-client';
import { CaptureWorker } from '../CaptureWorker.js';
import { FfmpegMediaTools } from '../Finalizer.js';
import {
	ChromiumRendererBridge,
	type RendererLifecycleEvent,
} from '../RendererBridge.js';
import type { CommandClaims, PublicJwk } from '../types.js';

const outputRoot = process.env.OUTPUT_ROOT ?? '/output';
const scenarioRoot = join(outputRoot, 'shared-stage');
const sfuOrigin = process.env.SFU_ORIGIN ?? 'http://sfu:3000';
const mediaHost = process.env.SFU_MEDIA_HOST ?? 'sfu';
const secret = process.env.JWT_SECRET ?? 'integration-secret';
const site = 'integration.local';
const room = 'adr-0011';
const job = 'integration-shared-stage';
const started = performance.now();
const socketTimeoutMs = 10_000;

type PlainTransport = { id: string; port: number };
type Producer = { id: string };

function waitForEvent(
	events: RendererLifecycleEvent[],
	type: RendererLifecycleEvent['type'],
	timeoutMs = 30_000,
): Promise<RendererLifecycleEvent> {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + timeoutMs;
		const poll = () => {
			const event = events.find((item) => item.type === type);
			if (event) resolve(event);
			else if (Date.now() >= deadline)
				reject(new Error(`timed out waiting for renderer ${type}`));
			else setTimeout(poll, 100);
		};
		poll();
	});
}

function request<T>(socket: Socket, event: string, data: object): Promise<T> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error(`timed out waiting for ${event} acknowledgement`)),
			socketTimeoutMs,
		);
		socket.emit(
			event,
			data,
			(response: T & { success?: boolean; error?: string }) => {
				clearTimeout(timeout);
				response?.success === false
					? reject(new Error(response.error || `${event} failed`))
					: resolve(response);
			},
		);
	});
}

function connect(socket: Socket): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timeout);
			socket.off('connect', connected);
			socket.off('connect_error', failed);
		};
		const connected = () => {
			cleanup();
			resolve();
		};
		const failed = (error: Error) => {
			cleanup();
			reject(error);
		};
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error('timed out connecting producer to SFU'));
		}, socketTimeoutMs);
		socket.once('connect', connected);
		socket.once('connect_error', failed);
	});
}

function run(
	program: string,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => (stdout += String(chunk)));
		child.stderr.on('data', (chunk) => (stderr += String(chunk)));
		child.once('error', reject);
		child.once('exit', (code) =>
			code === 0
				? resolve({ stdout, stderr })
				: reject(
						new Error(`${program} exited ${code}: ${stderr.slice(-2000)}`),
					),
		);
	});
}

function runBuffer(
	program: string,
	args: string[],
): Promise<{ stdout: Buffer; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		const stdout: Buffer[] = [];
		let stderr = '';
		child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on('data', (chunk) => (stderr += String(chunk)));
		child.once('error', reject);
		child.once('exit', (code) =>
			code === 0
				? resolve({ stdout: Buffer.concat(stdout), stderr })
				: reject(
						new Error(`${program} exited ${code}: ${stderr.slice(-2000)}`),
					),
		);
	});
}

function startFfmpeg(args: string[]): ChildProcess {
	const child = spawn(
		'/usr/bin/ffmpeg',
		['-hide_banner', '-loglevel', 'warning', ...args],
		{ stdio: ['ignore', 'ignore', 'pipe'] },
	);
	let diagnostics = '';
	child.stderr?.on('data', (chunk) => (diagnostics += String(chunk)));
	child.once('exit', (code) => {
		if (code && code !== 255)
			console.error(
				`producer FFmpeg exited ${code}: ${diagnostics.slice(-1000)}`,
			);
	});
	return child;
}

function assertProducerProcessesAlive(
	processes: ChildProcess[],
	phase: string,
) {
	for (const [index, process] of processes.entries()) {
		if (process.exitCode !== null || process.signalCode !== null) {
			throw new Error(
				`producer FFmpeg ${index} exited before ${phase} ` +
					`(code=${process.exitCode}, signal=${process.signalCode})`,
			);
		}
	}
}

function waitForProcessExit(
	process: ChildProcess,
	timeoutMs: number,
): Promise<boolean> {
	if (process.exitCode !== null || process.signalCode !== null)
		return Promise.resolve(true);
	return new Promise((resolve) => {
		const exited = () => {
			clearTimeout(timeout);
			resolve(true);
		};
		const timeout = setTimeout(() => {
			process.off('exit', exited);
			resolve(false);
		}, timeoutMs);
		process.once('exit', exited);
		if (process.exitCode !== null || process.signalCode !== null) exited();
	});
}

async function stopProducerProcess(process: ChildProcess): Promise<void> {
	if (process.exitCode !== null || process.signalCode !== null) return;
	process.kill('SIGTERM');
	if (await waitForProcessExit(process, 5_000)) return;
	process.kill('SIGKILL');
	if (!(await waitForProcessExit(process, 5_000)))
		throw new Error(`producer FFmpeg ${process.pid ?? 'unknown'} did not exit`);
}

function thumbprint(jwk: PublicJwk): string {
	return createHash('sha256')
		.update(JSON.stringify({ crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y }))
		.digest('base64url');
}

function recordingGrant(publicJwk: PublicJwk): string {
	const now = Math.floor(Date.now() / 1000);
	return jwt.sign(
		{
			protocol_version: 1,
			iss: `frappe-site:${site}`,
			aud: 'meet-sfu-recorder',
			scope: 'recording',
			jti: `grant-${Date.now()}`,
			site,
			meeting_id: room,
			recording_id: 'recording-shared-stage',
			recorder_job_id: job,
			cnf: { jwk: publicJwk, jkt: thumbprint(publicJwk) },
			iat: now,
			exp: now + 300,
			authorization_expires_at: now + 300,
		},
		secret,
		{
			algorithm: 'HS256',
			header: { alg: 'HS256', typ: 'meet-recording-grant+jwt' },
		},
	);
}

async function startProducers(): Promise<{
	sockets: Socket[];
	processes: ChildProcess[];
	producerIds: string[];
}> {
	const profiles: Array<{
		video: 'webcam' | 'screen';
		audio?: string;
		marker: string;
	}> = [
		{ video: 'webcam', audio: 'between(mod(t\\,4)\\,0\\,2.2)', marker: 'red' },
		{ video: 'webcam', audio: 'between(mod(t\\,4)\\,1.8\\,4)', marker: 'lime' },
		{ video: 'screen', marker: 'blue' },
		{ video: 'screen', marker: 'yellow' },
	];
	const sockets: Socket[] = [];
	const processes: ChildProcess[] = [];
	const producerIds: string[] = [];
	for (const [index, profile] of profiles.entries()) {
		const userId = `load-${index + 1}@example.invalid`;
		const now = Math.floor(Date.now() / 1000);
		const token = jwt.sign(
			{
				user_id: userId,
				user_name: `Load ${index + 1}`,
				meeting_id: room,
				is_host: index === 0,
				scope: 'full',
				site,
				iat: now,
				exp: now + 600,
			},
			secret,
		);
		const socket = io(sfuOrigin, {
			auth: { token },
			transports: ['websocket'],
			reconnection: false,
			timeout: socketTimeoutMs,
		});
		await connect(socket);
		sockets.push(socket);
		await request(socket, 'join_room', {
			roomId: room,
			connectionId: `producer-${index + 1}`,
			userData: { name: `Load ${index + 1}`, userId },
			mediaState: {
				audio_enabled: Boolean(profile.audio),
				video_enabled: true,
			},
		});
		if (profile.audio) {
			const transport = await request<PlainTransport>(
				socket,
				'create_plain_transport',
				{},
			);
			const audio = await request<Producer>(socket, 'create_producer', {
				transportId: transport.id,
				kind: 'audio',
				rtpParameters: {
					codecs: [
						{
							mimeType: 'audio/opus',
							clockRate: 48000,
							payloadType: 111,
							channels: 2,
						},
					],
					encodings: [{ ssrc: 111111 + index }],
				},
				appData: { source: 'mic' },
			});
			producerIds.push(audio.id);
			processes.push(
				startFfmpeg([
					'-re',
					'-f',
					'lavfi',
					'-i',
					'sine=frequency=997:sample_rate=48000',
					'-af',
					`volume='if(${profile.audio}\\,0.7\\,0)':eval=frame`,
					'-ac',
					'2',
					'-c:a',
					'libopus',
					'-b:a',
					'96k',
					'-payload_type',
					'111',
					'-ssrc',
					String(111111 + index),
					'-f',
					'rtp',
					`rtp://${mediaHost}:${transport.port}?pkt_size=1200`,
				]),
			);
		}
		const transport = await request<PlainTransport>(
			socket,
			'create_plain_transport',
			{},
		);
		const video = await request<Producer>(socket, 'create_producer', {
			transportId: transport.id,
			kind: 'video',
			rtpParameters: {
				codecs: [{ mimeType: 'video/VP8', clockRate: 90000, payloadType: 96 }],
				encodings: [{ ssrc: 222222 + index }],
			},
			appData: { source: profile.video },
		});
		producerIds.push(video.id);
		const size = '320x180';
		processes.push(
			startFfmpeg([
				'-re',
				'-f',
				'lavfi',
				'-i',
				`color=c=${profile.marker}:size=${size}:rate=30`,
				'-c:v',
				'libvpx',
				'-deadline',
				'realtime',
				'-cpu-used',
				'8',
				'-g',
				'2',
				'-b:v',
				'300k',
				'-payload_type',
				'96',
				'-ssrc',
				String(222222 + index),
				'-f',
				'rtp',
				`rtp://${mediaHost}:${transport.port}?pkt_size=1200`,
			]),
		);
	}
	await new Promise((resolve) => setTimeout(resolve, 1500));
	assertProducerProcessesAlive(processes, 'recorder startup');
	return { sockets, processes, producerIds };
}

await rm(scenarioRoot, { recursive: true, force: true });
await mkdir(scenarioRoot, { recursive: true });
const events: RendererLifecycleEvent[] = [];
let producer: Awaited<ReturnType<typeof startProducers>> | undefined;
let bridge: ChromiumRendererBridge | undefined;
let worker: CaptureWorker | undefined;
const renderer = (): ChromiumRendererBridge => {
	if (!bridge) throw new Error('renderer bridge is not initialized');
	return bridge;
};
try {
	producer = await startProducers();
	worker = new CaptureWorker(
		job,
		{
			dataRoot: scenarioRoot,
			display: 93,
			segmentSeconds: 4,
			ffmpeg: '/usr/bin/ffmpeg',
			xvfb: '/usr/bin/Xvfb',
			pulseaudio: '/usr/bin/pulseaudio',
			pactl: '/usr/bin/pactl',
			gracefulTimeoutMs: 10_000,
			recoveryTimeoutMs: 20_000,
			onCapturePreparing: (epoch) => renderer().prepareCapture(job, 0, epoch),
			onCaptureLaunched: (launch) =>
				renderer().captureStarted(
					job,
					0,
					launch.epoch,
					launch.capture_started_at,
				),
			onCaptureAborted: (epoch) => renderer().cancelCapture(job, 0, epoch),
		},
		{
			tools: new FfmpegMediaTools(
				'/usr/bin/ffmpeg',
				'/usr/bin/ffprobe',
				20_000,
			),
		},
	);
	await worker.initialize();
	const workerEnvironment = worker.env;
	bridge = new ChromiumRendererBridge({
		executablePath: '/usr/bin/chromium',
		assetDirectory: '/app/renderer',
		sfuOrigin,
		sfuSocketPath: '/socket.io',
		trustedCommandOrigin: 'http://integration.local',
		listenerPort: 0,
		noSandbox: true,
		reserveTimeoutMs: 30_000,
		configureTimeoutMs: 30_000,
		workerEnvironment: () => workerEnvironment,
	});
	bridge.onLifecycle(async (event) => {
		events.push(event);
	});
	await bridge.initialize();
	const now = Math.floor(Date.now() / 1000);
	const command: CommandClaims = {
		protocol_version: 1,
		iss: `frappe-site:${site}`,
		aud: 'meet-recorder-control',
		site,
		origin: 'http://integration.local',
		room,
		recording: 'recording-shared-stage',
		job,
		operation: 'reserve',
		policy: { recording_allowed: true },
		limits: {
			budget_bytes: 100_000_000,
			max_ends_at: new Date(Date.now() + 300_000).toISOString(),
			output: {
				width: 1920,
				height: 1080,
				fps: 30,
				video: 'h264',
				audio: 'aac',
			},
		},
		jti: 'command-shared-stage',
		iat: now,
		exp: now + 300,
	};
	const publicJwk = await bridge.reserve(command);
	const grantDeliveredAt = performance.now();
	await bridge.deliverGrant(
		job,
		recordingGrant(publicJwk),
		new Date().toISOString(),
		0,
	);
	await waitForEvent(events, 'capture_ready');
	const captureReadyAt = performance.now();
	const holdHealth = (await (await fetch(`${sfuOrigin}/health`)).json()) as {
		rooms: number;
		peers: number;
	};
	if (holdHealth.rooms !== 1 || holdHealth.peers !== 4)
		throw new Error(
			`Recorder Endpoint affected human SFU counts (rooms=${holdHealth.rooms}, peers=${holdHealth.peers})`,
		);
	await worker.startCapture();
	const captureStartedAt = performance.now();
	const segmentDeadline = Date.now() + 60_000;
	while (worker.manifest.get().segments.length < 3) {
		if (Date.now() >= segmentDeadline)
			throw new Error('timed out waiting for three captured segments');
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	for (;;) {
		const liveSegments = (await readdir(worker.manifest.directory))
			.filter((file) => file.endsWith('.ts'))
			.sort();
		const currentSegment = liveSegments.at(-1);
		if (
			currentSegment &&
			Date.now() -
				(await stat(join(worker.manifest.directory, currentSegment))).mtimeMs >=
				3_000
		)
			break;
		if (Date.now() >= segmentDeadline)
			throw new Error('timed out waiting for a probeable final segment');
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assertProducerProcessesAlive(producer.processes, 'artifact finalization');
	const captureStoppedAt = performance.now();
	const state = await worker.stop();
	assertProducerProcessesAlive(producer.processes, 'capture completion');
	if (state !== 'complete')
		throw new Error(`expected complete artifact, got ${state}`);
	const manifest = worker.manifest.get();
	const artifact = join(
		worker.manifest.directory,
		manifest.artifact?.file ?? '',
	);
	const artifactStat = await stat(artifact);
	if (!artifactStat.isFile() || artifactStat.size === 0)
		throw new Error('recording artifact is missing or empty');
	const probe = JSON.parse(
		(
			await run('/usr/bin/ffprobe', [
				'-v',
				'error',
				'-show_entries',
				'stream=codec_type,width,height,avg_frame_rate:format=duration',
				'-of',
				'json',
				artifact,
			])
		).stdout,
	);
	const videoStream = probe.streams.find(
		(stream: { codec_type: string }) => stream.codec_type === 'video',
	);
	const audioStream = probe.streams.find(
		(stream: { codec_type: string }) => stream.codec_type === 'audio',
	);
	const [fpsNumerator = 0, fpsDenominator = 0] = String(
		videoStream?.avg_frame_rate,
	)
		.split('/')
		.map(Number);
	const encodedDurationSeconds = Number(probe.format.duration);
	if (
		videoStream?.width !== 1920 ||
		videoStream?.height !== 1080 ||
		!audioStream ||
		fpsDenominator <= 0 ||
		fpsNumerator / fpsDenominator < 29 ||
		!Number.isFinite(encodedDurationSeconds) ||
		encodedDurationSeconds <= 0
	)
		throw new Error(
			'ffprobe did not find valid 1920x1080 30fps video and audio streams',
		);
	const decoded = await run('/usr/bin/ffmpeg', [
		'-v',
		'warning',
		'-i',
		artifact,
		'-f',
		'null',
		'-',
	]);
	if (decoded.stderr.trim())
		throw new Error(`artifact decode warning: ${decoded.stderr.slice(-2000)}`);
	const frames = await runBuffer('/usr/bin/ffmpeg', [
		'-v',
		'error',
		'-i',
		artifact,
		'-vf',
		'fps=4,scale=32:32,format=rgb24',
		'-f',
		'rawvideo',
		'-',
	]);
	const frameBytes = 32 * 32 * 3;
	const contentSamples = Array.from(
		{ length: Math.floor(frames.stdout.length / frameBytes) },
		(_, index) =>
			frames.stdout.subarray(index * frameBytes, (index + 1) * frameBytes),
	);
	const pixels = contentSamples.flatMap((sample) =>
		Array.from(
			{ length: sample.length / 3 },
			(_, index): [number, number, number] => [
				sample[index * 3] ?? 0,
				sample[index * 3 + 1] ?? 0,
				sample[index * 3 + 2] ?? 0,
			],
		),
	);
	const brightPixels = pixels.filter(
		([red, green, blue]) => red + green + blue > 650,
	).length;
	const coloredPixels = pixels.filter(
		([red, green, blue]) =>
			Math.max(red, green, blue) - Math.min(red, green, blue) > 50,
	).length;
	const markerPixels = {
		red: pixels.filter(
			([red, green, blue]) =>
				red > 120 && red > green * 1.5 && red > blue * 1.5,
		).length,
		lime: pixels.filter(
			([red, green, blue]) =>
				green > 120 && green > red * 1.5 && green > blue * 1.5,
		).length,
		blue: pixels.filter(
			([red, green, blue]) =>
				blue > 120 && blue > red * 1.5 && blue > green * 1.5,
		).length,
		yellow: pixels.filter(
			([red, green, blue]) => red > 120 && green > 120 && blue < 100,
		).length,
	};
	const distinctContentSamples = new Set(
		contentSamples.map((sample) =>
			createHash('sha256').update(sample).digest('hex'),
		),
	).size;
	if (Object.values(markerPixels).some((count) => count === 0))
		throw new Error(
			`MeetingLayout samples did not contain every publisher marker ` +
				`(markers=${JSON.stringify(markerPixels)}, total=${contentSamples.length})`,
		);
	const frequencyEnergy = await run('/usr/bin/ffmpeg', [
		'-v',
		'error',
		'-i',
		artifact,
		'-vn',
		'-af',
		'bandpass=f=997:width_type=h:w=120,asetnsamples=n=24000:pad=1,astats=metadata=1:reset=1,ametadata=print:file=-',
		'-f',
		'null',
		'-',
	]);
	let sampleTime = 0;
	const energySamples: Array<{ time: number; rms: number }> = [];
	for (const line of frequencyEnergy.stdout.split('\n')) {
		const timestamp = /pts_time:([\d.]+)/.exec(line)?.[1];
		if (timestamp !== undefined) sampleTime = Number(timestamp);
		const rms = /lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf)/.exec(
			line,
		)?.[1];
		if (rms !== undefined) {
			energySamples.push({
				time: sampleTime,
				rms: rms === '-inf' ? Number.NEGATIVE_INFINITY : Number(rms),
			});
		}
	}
	const durationSeconds = (manifest.artifact?.duration_ms ?? 0) / 1000;
	if (durationSeconds <= 0)
		throw new Error('artifact duration is missing from the capture manifest');
	const energeticSamples = energySamples.filter(({ rms }) => rms > -50);
	const energeticRatio = energeticSamples.length / energySamples.length;
	const coveredQuarters = Array.from({ length: 4 }, (_, quarter) =>
		energeticSamples.some(
			({ time }) =>
				time >= (durationSeconds * quarter) / 4 &&
				time <= (durationSeconds * (quarter + 1)) / 4,
		),
	).filter(Boolean).length;
	if (energySamples.length < 4 || energeticRatio < 0.7 || coveredQuarters !== 4)
		throw new Error(
			`997 Hz energy was not sustained across the artifact ` +
				`(energetic=${energeticSamples.length}/${energySamples.length}, quarters=${coveredQuarters}/4)`,
		);
	await Promise.all(
		producer.processes.map((process) => stopProducerProcess(process)),
	);
	for (const socket of producer.sockets) socket.disconnect();
	await bridge.stop(job);
	const cleanupStartedAt = performance.now();
	let cleanupHealth = holdHealth;
	while (performance.now() - cleanupStartedAt < 65_000) {
		cleanupHealth = (await (
			await fetch(`${sfuOrigin}/health`)
		).json()) as typeof holdHealth;
		if (cleanupHealth.rooms === 0 && cleanupHealth.peers === 0) break;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	if (cleanupHealth.rooms !== 0 || cleanupHealth.peers !== 0)
		throw new Error('Recorder Endpoint kept the human-empty room occupied');
	const result = {
		state,
		elapsed_ms: Math.round(performance.now() - started),
		artifact,
		artifact_bytes: artifactStat.size,
		duration_ms: manifest.artifact?.duration_ms,
		encoded_duration_seconds: encodedDurationSeconds,
		video: {
			width: videoStream.width,
			height: videoStream.height,
			average_frame_rate: videoStream.avg_frame_rate,
		},
		audio_stream: true,
		startup_to_ready_ms: Math.round(captureReadyAt - grantDeliveredAt),
		ready_to_capture_ms: Math.round(captureStartedAt - captureReadyAt),
		capture_elapsed_ms: Math.round(captureStoppedAt - captureStartedAt),
		interruption_events: events.filter(({ type }) => type === 'interrupted')
			.length,
		human_participant_connections: 4,
		camera_publishers: 2,
		screen_publishers: 2,
		rotating_talkers: 2,
		sfu_hold: holdHealth,
		cleanup: {
			...cleanupHealth,
			elapsed_ms: Math.round(performance.now() - cleanupStartedAt),
		},
		segments: manifest.segments.length,
		producer_ids: producer.producerIds,
		producer_ingress:
			'development-only plain RTP test injection; production media uses WebRTC',
		content_samples: contentSamples.length,
		bright_content_pixels: brightPixels,
		colored_content_pixels: coloredPixels,
		marker_pixels: markerPixels,
		distinct_content_samples: distinctContentSamples,
		frequency_hz: 997,
		frequency_energy_samples: energySamples.length,
		frequency_energetic_samples: energeticSamples.length,
		frequency_covered_quarters: coveredQuarters,
		decode_warnings: 0,
	};
	await writeFile(
		join(scenarioRoot, 'result.json'),
		`${JSON.stringify(result, null, 2)}\n`,
	);
	console.log(JSON.stringify(result));
} finally {
	await Promise.all(
		(producer?.processes ?? []).map((process) => stopProducerProcess(process)),
	).catch((error) => console.error('producer FFmpeg cleanup failed', error));
	for (const socket of producer?.sockets ?? []) socket.disconnect();
	await bridge?.stop(job).catch(() => undefined);
	await bridge?.close().catch(() => undefined);
	if (
		worker &&
		!['complete', 'partial', 'failed'].includes(worker.manifest.get().state)
	)
		await worker
			.stop(true, 'integration_harness_failed')
			.catch(() => undefined);
}
