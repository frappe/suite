export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface PlatformError<Type extends string = string> {
  type: Type
  message: string
  status: number
  [key: string]: unknown
}

export class TransportError<Type extends string = string> extends Error implements PlatformError<Type> {
  [key: string]: unknown
  readonly type: Type
  readonly status: number
  readonly details: Record<string, unknown>
  /** How long the server asked the caller to wait, from a 429's `Retry-After`. */
  readonly retryAfterMs?: number

  constructor(error: PlatformError<Type>) {
    super(error.message)
    this.name = 'TransportError'
    this.type = error.type
    this.status = error.status
    this.details = { ...error }
    if (typeof error.retryAfterMs === 'number') this.retryAfterMs = error.retryAfterMs
  }
}

export interface EntityDeclaration {
  tag: string
  id: string
  version?: string | null
  doctype?: string
}

export interface Operation<Input = unknown, Output = unknown, ErrorType extends string = string> {
  id: string
  owner: string
  method: HttpMethod
  path: string
  prefix?: string
  pathParams?: readonly string[]
  nodeParams?: readonly string[]
  entity?: EntityDeclaration | null
  errors?: readonly ErrorType[]
  validateInput?: (input: unknown) => asserts input is Input
  validateOutput?: (output: unknown) => asserts output is Output
  /**
   * Lets the module that owns the operation add headers to one request and
   * see how it ended. Runs once per call, before the first attempt. It may
   * throw to refuse the call, and then nothing is sent.
   */
  scope?(input: Input): RequestScope<Output>
}

export interface RequestScope<Output = unknown> {
  /** Sent as given. Transport does not read, cut or merge them. */
  headers?: Readonly<Record<string, string>>
  /** Runs once after the final attempt. It does not run when the call is aborted. */
  settled?(outcome: RequestOutcome<Output>): void
}

export type RequestOutcome<Output = unknown> =
  | { ok: true; output: Output }
  | { ok: false; error: TransportError }

export interface TransportOptions {
  signal?: AbortSignal
  headers?: HeadersInit
}

export interface Transport {
  request<Input, Output, ErrorType extends string = string>(
    operation: Operation<Input, Output, ErrorType>,
    input: Input,
    options?: TransportOptions,
  ): Promise<Output>
}

export interface CreateTransportOptions {
  fetch?: typeof fetch
  maxRetries?: number
  retryBaseMs?: number
  onSessionExpired?: (error: PlatformError<'SessionExpired'>) => void
}

type ErrorEnvelope = {
  errors?: Array<{ type?: unknown; message?: unknown; [key: string]: unknown }>
  error?: { type?: unknown; message?: unknown; [key: string]: unknown }
  message?: unknown
}

const DEFAULT_RETRIES = 2

export function createTransport(options: CreateTransportOptions = {}): Transport {
  const fetcher = options.fetch ?? globalThis.fetch
  const maxRetries = options.maxRetries ?? DEFAULT_RETRIES
  const retryBaseMs = options.retryBaseMs ?? 100

  if (!fetcher) throw new Error('A fetch implementation is required')

  return {
    async request(operation, input, requestOptions = {}) {
      validateOperation(operation)
      operation.validateInput?.(input)

      const pathInput = asRecord(input)
      const url = buildUrl(operation, pathInput)
      const scope = operation.scope?.(input)
      const headers = new Headers(scope?.headers)
      new Headers(requestOptions.headers).forEach((value, name) => headers.set(name, value))
      headers.set('Accept', 'application/json')
      const csrf = readCsrfToken()
      if (csrf) headers.set('X-Frappe-CSRF-Token', csrf)

      const init: RequestInit = {
        method: operation.method,
        headers,
        credentials: 'same-origin',
        signal: requestOptions.signal,
      }
      if (operation.method !== 'GET') {
        headers.set('Content-Type', 'application/json; charset=utf-8')
        init.body = JSON.stringify(withoutPathParams(pathInput, operation.pathParams ?? []))
      }

      const failed = (error: TransportError): TransportError => {
        scope?.settled?.({ ok: false, error })
        return error
      }

      let attempt = 0
      while (true) {
        let response: Response
        try {
          response = await fetcher(url, init)
        } catch (cause) {
          if (isAbort(cause)) throw cause
          if (operation.method !== 'GET' || attempt >= maxRetries) {
            throw failed(new TransportError({ type: 'NetworkError', message: networkMessage(cause), status: 0 }))
          }
          await delay(retryBaseMs * 2 ** attempt, requestOptions.signal)
          attempt += 1
          continue
        }

        const body = await readBody(response)
        if (response.ok) {
          const output = decodeSuccess(body)
          if (import.meta.env.DEV) operation.validateOutput?.(output)
          scope?.settled?.({ ok: true, output: output as never })
          return output as never
        }

        const error = decodeError(body, response.status, response.statusText)
        const retryAfter = response.status === 429 ? parseRetryAfter(response.headers.get('Retry-After')) : null
        if (retryAfter !== null) error.retryAfterMs = retryAfter
        if (error.type === 'SessionExpired') {
          options.onSessionExpired?.(error as PlatformError<'SessionExpired'>)
        }

        const retryable =
          operation.method === 'GET' &&
          attempt < maxRetries &&
          (response.status >= 500 || response.status === 429)
        if (!retryable) throw failed(new TransportError(error))

        await delay(retryAfter ?? retryBaseMs * 2 ** attempt, requestOptions.signal)
        attempt += 1
      }
    },
  }
}

export const transport = createTransport()

function validateOperation(operation: Operation): void {
  if (!operation?.id || !operation.owner || !operation.method || !operation.path) {
    throw new TypeError('Malformed operation descriptor')
  }
}

function buildUrl(operation: Operation, input: Record<string, unknown>): string {
  let path = operation.path.replace(/\{([^}:]+)(?::path)?\}/g, (_match, name: string) => {
    const value = input[name]
    if (value === undefined || value === null || value === '') {
      throw new TypeError(`Missing path parameter: ${name}`)
    }
    return encodeURIComponent(String(value))
  })
  if (!path.startsWith('/')) path = `${operation.prefix ?? `/api/suite/${operation.owner}/`}${path}`
  if (operation.method === 'GET') {
    const query = new URLSearchParams()
    const pathParams = new Set(operation.pathParams ?? [])
    for (const [key, value] of Object.entries(input)) appendQuery(query, key, value, pathParams)
    const encoded = query.toString()
    if (encoded) path += `${path.includes('?') ? '&' : '?'}${encoded}`
  }
  return path
}

function appendQuery(
  query: URLSearchParams,
  key: string,
  value: unknown,
  pathParams: ReadonlySet<string>,
): void {
  if (pathParams.has(key) || value === undefined || value === null) return
  if (Array.isArray(value)) {
    query.append(key, JSON.stringify(value))
    return
  }
  query.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
}

function withoutPathParams(input: Record<string, unknown>, pathParams: readonly string[]): Record<string, unknown> {
  const omitted = new Set(pathParams)
  return Object.fromEntries(Object.entries(input).filter(([key]) => !omitted.has(key)))
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Operation input must be an object')
  return input as Record<string, unknown>
}

function decodeSuccess(body: unknown): unknown {
  if (isRecord(body) && 'data' in body) return body.data
  return body
}

function decodeError(body: unknown, status: number, fallback: string): PlatformError {
  const envelope = isRecord(body) ? (body as ErrorEnvelope) : {}
  const first = Array.isArray(envelope.errors) ? envelope.errors[0] : envelope.error
  const type = stringValue(first?.type) ?? 'RequestError'
  const message =
    stringValue(first?.message) ??
    (typeof envelope.message === 'string' ? envelope.message : null) ??
    stringValue(fallback) ??
    'Request failed'
  return { ...(isRecord(first) ? first : {}), type, message, status }
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function readCsrfToken(): string | null {
  if (typeof window === 'undefined') return null
  const token = window.csrf_token
  return token && token !== '{{ csrf_token }}' ? token : null
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function isAbort(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError'
}

function networkMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Network request failed'
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null
}
