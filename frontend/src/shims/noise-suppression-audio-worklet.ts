/**
 * Thin reimplementation of @workadventure/noise-suppression/audio-worklet that
 * never references `new URL(..., import.meta.url)`.
 *
 * Importing the package entry would pull the 17MB processor + LiteRT vendor
 * assets into the Vite/Rollup graph on every production build. We load the
 * prebundled processor from a static Frappe/Vite public path instead.
 *
 * Processor name and message protocol match package v0.0.4.
 */

/** Absolute URL of the static worklet (see scripts/copy-noise-suppression-assets.mjs). */
export const NOISE_SUPPRESSION_WORKLET_URL = import.meta.env.DEV
  ? '/noise-suppression/audio-worklet-processor.js'
  : '/assets/suite/noise-suppression/audio-worklet-processor.js'

export const NOISE_SUPPRESSION_AUDIO_WORKLET_PROCESSOR_NAME =
  'workadventure-noise-suppression'

const DEFAULT_READY_TIMEOUT_MS = 30_000

interface AudioWorkletCapableContext extends BaseAudioContext {
  readonly audioWorklet: AudioWorklet
}

export interface NoiseSuppressionAudioWorkletOptions {
  moduleUrl?: string
  threads?: boolean
  numThreads?: number
  bypassUntilReady?: boolean
  readyTimeoutMs?: number
}

export interface NoiseSuppressionAudioWorkletReadyMessage {
  type: 'ready'
  modelDetails?: unknown
}

export interface NoiseSuppressionAudioWorkletHandle {
  node: AudioWorkletNode
  ready: Promise<NoiseSuppressionAudioWorkletReadyMessage>
  moduleUrl: string
  processorName: string
  dispose(): void
}

const moduleLoadCache = new WeakMap<AudioWorkletCapableContext, Map<string, Promise<void>>>()

function defaultNumThreads(override?: number): number {
  if (Number.isFinite(override) && override !== undefined && override > 0) {
    return Math.floor(override)
  }
  const cores =
    typeof navigator !== 'undefined' &&
    Number.isFinite(navigator.hardwareConcurrency) &&
    navigator.hardwareConcurrency > 0
      ? navigator.hardwareConcurrency
      : 1
  return Math.max(1, Math.min(4, cores))
}

function addModuleOnce(
  context: AudioWorkletCapableContext,
  moduleUrl: string,
): Promise<void> {
  let byUrl = moduleLoadCache.get(context)
  if (!byUrl) {
    byUrl = new Map()
    moduleLoadCache.set(context, byUrl)
  }
  let pending = byUrl.get(moduleUrl)
  if (pending) return pending
  // Drop failed loads from the cache so a missing file / transient fetch
  // error can succeed on a later call (e.g. after prebuild copies the asset).
  pending = context.audioWorklet.addModule(moduleUrl).catch((err) => {
    byUrl.delete(moduleUrl)
    throw err
  })
  byUrl.set(moduleUrl, pending)
  return pending
}

function waitForReady(
  node: AudioWorkletNode,
  timeoutMs: number,
): Promise<NoiseSuppressionAudioWorkletReadyMessage> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      cleanup()
      reject(
        new Error(
          'Timed out waiting for the noise suppression worklet to initialize.',
        ),
      )
    }, timeoutMs)

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; message?: string }
      if (data?.type === 'ready') {
        cleanup()
        resolve(data as NoiseSuppressionAudioWorkletReadyMessage)
        return
      }
      if (data?.type === 'error') {
        cleanup()
        reject(new Error(data.message || 'Noise suppression worklet error'))
      }
    }

    const onProcessorError = () => {
      cleanup()
      reject(new Error('The noise suppression AudioWorklet processor failed.'))
    }

    const cleanup = () => {
      globalThis.clearTimeout(timer)
      node.port.removeEventListener('message', onMessage)
      node.removeEventListener('processorerror', onProcessorError)
    }

    node.port.addEventListener('message', onMessage)
    node.port.start()
    node.addEventListener('processorerror', onProcessorError)
  })
}

export async function createNoiseSuppressionAudioWorklet(
  context: AudioWorkletCapableContext,
  options: NoiseSuppressionAudioWorkletOptions = {},
): Promise<NoiseSuppressionAudioWorkletHandle> {
  const moduleUrl = options.moduleUrl ?? NOISE_SUPPRESSION_WORKLET_URL
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
  const threads = options.threads === true
  const numThreads = defaultNumThreads(options.numThreads)
  const bypassUntilReady = options.bypassUntilReady ?? true

  await addModuleOnce(context, moduleUrl)

  const node = new AudioWorkletNode(
    context,
    NOISE_SUPPRESSION_AUDIO_WORKLET_PROCESSOR_NAME,
    {
      channelCount: 1,
      channelCountMode: 'explicit',
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        threads,
        numThreads,
        bypassUntilReady,
      },
    },
  )

  return {
    node,
    ready: waitForReady(node, readyTimeoutMs),
    moduleUrl,
    processorName: NOISE_SUPPRESSION_AUDIO_WORKLET_PROCESSOR_NAME,
    dispose() {
      node.port.postMessage({ type: 'dispose' })
      node.disconnect()
    },
  }
}
