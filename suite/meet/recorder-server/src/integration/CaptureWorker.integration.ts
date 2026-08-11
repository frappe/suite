import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { CaptureWorker } from '../CaptureWorker.js';
import {
	type ManagedProcess,
	ProcessSupervisor,
} from '../ProcessSupervisor.js';

const scenario = process.argv[2];
if (scenario !== 'clean' && scenario !== 'recovery') {
	throw new Error('usage: CaptureWorker.integration.js clean|recovery');
}

const outputRoot = process.env.OUTPUT_ROOT ?? '/output';
const scenarioRoot = join(outputRoot, scenario);
const started = performance.now();

class ObservableSupervisor extends ProcessSupervisor {
	ffmpeg?: ManagedProcess;
	override async start(
		command: string,
		args: string[],
		options: Parameters<ProcessSupervisor['start']>[2],
	): Promise<ManagedProcess> {
		const process = await super.start(command, args, options);
		if (command.endsWith('/ffmpeg') || command === 'ffmpeg')
			this.ffmpeg = process;
		return process;
	}
	killFfmpeg(): void {
		if (!this.ffmpeg?.pid) throw new Error('FFmpeg is not running');
		process.kill(-this.ffmpeg.pid, 'SIGKILL');
	}
}

async function waitFor(
	description: string,
	condition: () => boolean,
	timeoutMs = 30_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() >= deadline)
			throw new Error(`timed out waiting for ${description}`);
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}

async function launchRenderer(env: NodeJS.ProcessEnv): Promise<Browser> {
	const browser = await puppeteer.launch({
		executablePath: process.env.CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium',
		headless: false,
		env,
		args: [
			'--no-sandbox',
			'--disable-dev-shm-usage',
			'--autoplay-policy=no-user-gesture-required',
			'--window-position=0,0',
			'--window-size=1920,1080',
			'--kiosk',
		],
	});
	const page = (await browser.pages())[0] ?? (await browser.newPage());
	await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
	await page.setContent(`<!doctype html><html><style>
		html,body,canvas{margin:0;width:100%;height:100%;overflow:hidden;background:#101828}
	</style><canvas width="1920" height="1080"></canvas><script>
		const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
		const audio=new AudioContext({sampleRate:48000});
		const oscillator=audio.createOscillator(),gain=audio.createGain();
		oscillator.frequency.value=440;gain.gain.value=.08;
		oscillator.connect(gain).connect(audio.destination);oscillator.start();audio.resume();
		let frame=0;
		function draw(){
			const hue=(frame++*2)%360;
			ctx.fillStyle='hsl('+hue+' 55% 18%)';ctx.fillRect(0,0,1920,1080);
			ctx.fillStyle='#fff';ctx.font='bold 96px sans-serif';ctx.fillText('CaptureWorker Linux integration',120,260);
			ctx.fillStyle='hsl('+(hue+180)+' 90% 60%)';ctx.fillRect(120+(frame*11)%1500,420,240,240);
			ctx.font='48px monospace';ctx.fillStyle='#fff';ctx.fillText(String(frame).padStart(8,'0'),120,850);
			requestAnimationFrame(draw);
		} draw();
	</script></html>`);
	return browser;
}

async function command(program: string, args: string[]): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const child = spawn(program, args, { stdio: ['ignore', 'ignore', 'pipe'] });
		let error = '';
		child.stderr.on('data', (chunk) => (error += String(chunk)));
		child.once('error', reject);
		child.once('exit', (code) =>
			code === 0 ? resolve(error) : reject(new Error(error.slice(-2000))),
		);
	});
}

await rm(scenarioRoot, { recursive: true, force: true });
await mkdir(scenarioRoot, { recursive: true });
const supervisor = new ObservableSupervisor();
const worker = new CaptureWorker(
	`integration-${scenario}`,
	{
		dataRoot: scenarioRoot,
		display: scenario === 'clean' ? 91 : 92,
		segmentSeconds: 2,
		ffmpeg: '/usr/bin/ffmpeg',
		xvfb: '/usr/bin/Xvfb',
		pulseaudio: '/usr/bin/pulseaudio',
		pactl: '/usr/bin/pactl',
		gracefulTimeoutMs: 10_000,
		recoveryTimeoutMs: 20_000,
	},
	supervisor,
);

let browser: Browser | undefined;
let initialized = false;
try {
	await worker.initialize();
	initialized = true;
	browser = await launchRenderer(worker.env);
	await worker.startCapture();
	await waitFor(
		'three captured segments',
		() => worker.manifest.get().segments.length >= 3,
	);
	if (scenario === 'recovery') {
		supervisor.killFfmpeg();
		await waitFor('closed recovery gap and second epoch', () => {
			const manifest = worker.manifest.get();
			return manifest.epochs === 2 && Boolean(manifest.gaps[0]?.ended_at);
		});
		await waitFor(
			'two recovered segments',
			() =>
				worker.manifest.get().segments.filter((item) => item.epoch === 1)
					.length >= 2,
		);
	}
	const state = await worker.stop();
	const manifest = worker.manifest.get();
	const expectedState = scenario === 'clean' ? 'complete' : 'partial';
	if (state !== expectedState)
		throw new Error(`expected ${expectedState}, got ${state}`);
	if (manifest.segments.length < 3)
		throw new Error('fewer than three segments');
	if (manifest.segments.some((item, index) => item.index !== index))
		throw new Error('segments are not ordered');
	if (scenario === 'recovery') {
		if (
			manifest.epochs !== 2 ||
			manifest.gaps.length !== 1 ||
			!manifest.gaps[0]?.ended_at
		)
			throw new Error('recovery epoch/gap was not persisted');
		if (
			!manifest.segments.some((item) => item.epoch === 0) ||
			!manifest.segments.some((item) => item.epoch === 1)
		)
			throw new Error('both capture epochs must contribute segments');
	}
	const artifact = join(
		worker.manifest.directory,
		manifest.artifact?.file ?? '',
	);
	const decodeWarnings = await command('/usr/bin/ffmpeg', [
		'-v',
		'warning',
		'-i',
		artifact,
		'-f',
		'null',
		'-',
	]);
	if (decodeWarnings.trim())
		throw new Error(`artifact decode warning: ${decodeWarnings.slice(-2000)}`);
	const persisted = JSON.parse(
		await readFile(worker.manifest.path, 'utf8'),
	) as typeof manifest;
	if (persisted.state !== expectedState)
		throw new Error('persisted manifest state mismatch');
	const result = {
		scenario,
		state,
		elapsed_ms: Math.round(performance.now() - started),
		manifest: worker.manifest.path,
		artifact,
		artifact_bytes: manifest.artifact?.bytes,
		duration_ms: manifest.artifact?.duration_ms,
		segments: manifest.segments.map(({ index, epoch, file, duration_ms }) => ({
			index,
			epoch,
			file,
			duration_ms,
		})),
		gaps: manifest.gaps,
	};
	await writeFile(
		join(scenarioRoot, 'result.json'),
		`${JSON.stringify(result, null, 2)}\n`,
	);
	console.log(JSON.stringify(result));
} finally {
	await browser?.close().catch(() => undefined);
	if (
		initialized &&
		!['complete', 'partial', 'failed'].includes(worker.manifest.get().state)
	)
		await worker
			.stop(true, 'integration_harness_failed')
			.catch(() => undefined);
}
