export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface PlatformError<Type extends string = string> {
  type: Type
  message: string
  status: number
  [key: string]: unknown
}

export class TransportError<Type extends string = string>
  extends Error
  implements PlatformError<Type>
{
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
  readonly kind?: 'query' | 'mutation'
  readonly publicName?: string
  readonly envelope?: 'message'
  readonly bytes?: boolean
  readonly empty?: boolean
  readonly types?: { input: Input; output: Output; error: ErrorType }
  loadValidators?: () => Promise<Validators<Input, Output>>
  localParams?: readonly string[]
  id: string
  owner: string
  method: HttpMethod
  path: string
  prefix?: string
  pathParams?: readonly string[]
  nodeParams?: readonly string[]
  entity?: EntityDeclaration | null
  /**
   * Names the input field whose `Blob` is the raw request body, such as an
   * upload chunk. The other fields then go in the query string.
   */
  body?: string
  errors?: readonly ErrorType[]
  validateInput?: (input: unknown) => asserts input is Input
  validateOutput?: (output: unknown) => asserts output is Output
  /**
   * Lets the module that owns the operation add headers to one request and
   * see how it ended. Runs once per call, before the first attempt. It may
   * throw to refuse the call, and then nothing is sent.
   */
  scope?(input: NoInfer<Input>): RequestScope<NoInfer<Output>>
}

export interface Validators<I, O> {
  validateInput(input: unknown): asserts input is I
  validateOutput(output: unknown): asserts output is O
}

export interface QueryRef<I, O, E extends string = string> extends Operation<I, O, E> {
  readonly kind: 'query'
}

export interface MutationRef<I, O, E extends string = string> extends Operation<I, O, E> {
  readonly kind: 'mutation'
}

export type PageCapability =
  | { cursor: string; rows: string; next: string }
  | { offset: string; rows: string; total: string }
  | { offset: string; rows: string; more: string }

export interface PageRef<
  I,
  Row,
  E extends string = string,
  O = { rows: Row[]; next_cursor: string | null },
> extends QueryRef<I, O, E> {
  readonly page: PageCapability
  readonly rowType?: Row
}

export interface TransferRef<I, O> {
  readonly kind: 'transfer'
  readonly id: string
  readonly owner: string
  readonly types?: { input: I; output: O }
}

export interface RequestScope<Output = unknown> {
  /** Sent as given. Transport does not read, cut or merge them. */
  headers?: Readonly<Record<string, string>>
  /** Runs once after the final attempt. It does not run when the call is aborted. */
  settled?(outcome: RequestOutcome<Output>): void
}

export type RequestOutcome<Output = unknown> =
  { ok: true; output: Output } | { ok: false; error: TransportError }

/** An owner selects credentials and gives the engine an opaque access identity. */
export interface RequestContext {
  partition(): string
  scope(): RequestScope
}

export interface TransportOptions {
  context?: RequestContext
  keepalive?: boolean
  signal?: AbortSignal
  headers?: HeadersInit
}

export interface BytesOptions extends TransportOptions {
  body?: Uint8Array<ArrayBuffer>
  keepalive?: boolean
}

export interface BytesResponse {
  status: number
  headers: Headers
  bytes: Uint8Array
}

export interface Transport {
  request<Input, Output, ErrorType extends string = string>(
    operation: Operation<Input, Output, ErrorType>,
    input: NoInfer<Input>,
    options?: TransportOptions,
  ): Promise<Output>
}

export interface CreateTransportOptions {
  fetch?: typeof fetch
  maxRetries?: number
  retryBaseMs?: number
  onFailure?: (error: TransportError) => void
  onSessionExpired?: (error: PlatformError<'SessionExpired'>) => void
}

type ErrorEnvelope = {
  errors?: Array<{ type?: unknown; message?: unknown; [key: string]: unknown }>
  error?: { type?: unknown; message?: unknown; [key: string]: unknown }
  message?: unknown
  exc_type?: unknown
  _server_messages?: unknown
}

const DEFAULT_RETRIES = 2

export function createTransport(options: CreateTransportOptions = {}): Transport & {
  // Answers every status as it came: the caller reads its own verdicts. Only a
  // network failure throws, and nothing is retried
  requestBytes(
    operation: Operation,
    input: Record<string, unknown>,
    options?: BytesOptions,
  ): Promise<BytesResponse>
} {
  const fetcher = options.fetch ?? globalThis.fetch
  const maxRetries = options.maxRetries ?? DEFAULT_RETRIES
  const retryBaseMs = options.retryBaseMs ?? 100

  if (!fetcher) throw new Error('A fetch implementation is required')

  return {
    async request(operation, input, requestOptions = {}) {
      validateOperation(operation)
      const validators: Validators<typeof input, unknown> | undefined =
        await operation.loadValidators?.()
      validators?.validateInput(input)
      operation.validateInput?.(input)
      requestOptions.signal?.throwIfAborted()

      const pathInput = asRecord(input)
      const rawBody = operation.body ? pathInput[operation.body] : undefined
      if (operation.body && !(rawBody instanceof Blob)) {
        throw new TypeError(`Operation input field ${operation.body} must be a Blob`)
      }
      const url = buildUrl(operation, pathInput)
      const scope = requestOptions.context?.scope() ?? operation.scope?.(input)
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
        keepalive: requestOptions.keepalive,
      }
      if (rawBody instanceof Blob) {
        headers.set('Content-Type', 'application/octet-stream')
        init.body = rawBody
      } else if (operation.method !== 'GET' && operation.method !== 'DELETE') {
        headers.set('Content-Type', 'application/json; charset=utf-8')
        init.body = JSON.stringify(
          withoutPathParams(pathInput, [
            ...(operation.pathParams ?? []),
            ...(operation.localParams ?? []),
          ]),
        )
      }

      const failed = (error: TransportError): TransportError => {
        scope?.settled?.({ ok: false, error })
        options.onFailure?.(error)
        return error
      }

      let attempt = 0
      while (true) {
        let response: Response
        try {
          response = await fetcher(url, init)
        } catch (cause) {
          if (isAbort(cause)) throw cause
          if (
            !(
              operation.kind === 'query' ||
              (operation.kind === undefined && operation.method === 'GET')
            ) ||
            attempt >= maxRetries
          ) {
            throw failed(
              new TransportError({
                type: 'NetworkError',
                message: networkMessage(cause),
                status: 0,
              }),
            )
          }
          await delay(retryBaseMs * 2 ** attempt, requestOptions.signal)
          attempt += 1
          continue
        }

        requestOptions.signal?.throwIfAborted()
        const body =
          response.ok && operation.bytes ? await response.blob() : await readBody(response)
        requestOptions.signal?.throwIfAborted()
        if (response.ok) {
          const output =
            operation.empty &&
            isRecord(body) &&
            Object.keys(body).every((key) => key === 'docs' || key === '_server_messages')
              ? null
              : decodeSuccess(body, operation.envelope)
          validators?.validateOutput(output)
          operation.validateOutput?.(output)
          scope?.settled?.({ ok: true, output: output as never })
          return output as never
        }

        const error = decodeError(body, response.status, response.statusText)
        const retryAfter =
          response.status === 429 ? parseRetryAfter(response.headers.get('Retry-After')) : null
        if (retryAfter !== null) error.retryAfterMs = retryAfter
        if (error.type === 'SessionExpired') {
          options.onSessionExpired?.(error as PlatformError<'SessionExpired'>)
        }

        const retryable =
          (operation.kind === 'query' ||
            (operation.kind === undefined && operation.method === 'GET')) &&
          attempt < maxRetries &&
          (response.status >= 500 || response.status === 429)
        if (!retryable) throw failed(new TransportError(error))

        await delay(retryAfter ?? retryBaseMs * 2 ** attempt, requestOptions.signal)
        attempt += 1
      }
    },

    async requestBytes(operation, input, requestOptions = {}) {
      validateOperation(operation)
      const url = buildUrl(operation, input)
      const headers = new Headers(requestOptions.headers)
      headers.set('Accept', 'application/octet-stream, application/json')
      const csrf = readCsrfToken()
      if (csrf) headers.set('X-Frappe-CSRF-Token', csrf)
      const init: RequestInit = {
        method: operation.method,
        headers,
        credentials: 'same-origin',
        signal: requestOptions.signal,
        keepalive: requestOptions.keepalive,
      }
      if (requestOptions.body) {
        headers.set('Content-Type', 'application/octet-stream')
        init.body = requestOptions.body
      }
      let response: Response
      try {
        response = await fetcher(url, init)
      } catch (cause) {
        if (isAbort(cause)) throw cause
        throw new TransportError({
          type: 'NetworkError',
          message: networkMessage(cause),
          status: 0,
        })
      }
      return {
        status: response.status,
        headers: response.headers,
        bytes: new Uint8Array(await response.arrayBuffer()),
      }
    },
  }
}

// What to tell a person when a request failed before the server could answer it properly; null for any other status
export function describeFailure(status: number | null): string | null {
  if (status === 0) return "Couldn't reach the server. Check your connection and try again."
  if (status === 408 || status === 429) return 'The server is busy. Try again in a moment.'
  if (status !== null && status >= 500)
    return 'The server had a problem opening this document. Try again in a moment.'
  return null
}

const failureListeners = new Set<(error: TransportError) => void>()
export function onTransportFailure(listener: (error: TransportError) => void): () => void {
  failureListeners.add(listener)
  return () => {
    failureListeners.delete(listener)
  }
}
export const transport = createTransport({
  onFailure: (error) => {
    for (const listener of failureListeners) listener(error)
  },
})

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
  if (operation.method === 'GET' || operation.method === 'DELETE' || operation.body) {
    const query = new URLSearchParams()
    const omitted = new Set([
      ...(operation.pathParams ?? []),
      ...(operation.localParams ?? []),
      ...(operation.body ? [operation.body] : []),
    ])
    for (const [key, value] of Object.entries(input)) appendQuery(query, key, value, omitted)
    const encoded = query.toString()
    if (encoded) path += `${path.includes('?') ? '&' : '?'}${encoded}`
  }
  return path
}

function appendQuery(
  query: URLSearchParams,
  key: string,
  value: unknown,
  omitted: ReadonlySet<string>,
): void {
  if (omitted.has(key) || value === undefined || value === null) return
  if (Array.isArray(value)) {
    query.append(key, JSON.stringify(value))
    return
  }
  query.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
}

function withoutPathParams(
  input: Record<string, unknown>,
  pathParams: readonly string[],
): Record<string, unknown> {
  const omitted = new Set(pathParams)
  return Object.fromEntries(Object.entries(input).filter(([key]) => !omitted.has(key)))
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('Operation input must be an object')
  return input as Record<string, unknown>
}

function decodeSuccess(body: unknown, envelope?: 'message'): unknown {
  if (envelope === 'message') return isRecord(body) && 'message' in body ? body.message : null
  if (isRecord(body) && 'data' in body) return body.data
  return body
}

function decodeError(body: unknown, status: number, fallback: string): PlatformError {
  const envelope = isRecord(body) ? (body as ErrorEnvelope) : {}
  const first = Array.isArray(envelope.errors) ? envelope.errors[0] : envelope.error
  const type = stringValue(first?.type) ?? stringValue(envelope.exc_type) ?? 'RequestError'
  const message =
    stringValue(first?.message) ??
    serverMessage(envelope._server_messages) ??
    (typeof envelope.message === 'string' ? envelope.message : null) ??
    stringValue(fallback) ??
    'Request failed'
  return { ...(isRecord(first) ? first : {}), type, message, status }
}

function serverMessage(encoded: unknown): string | null {
  if (typeof encoded !== 'string') return null
  try {
    const messages: unknown = JSON.parse(encoded)
    const first: unknown = Array.isArray(messages) ? messages[0] : messages
    const decoded: unknown = typeof first === 'string' ? JSON.parse(first) : first
    return isRecord(decoded) ? stringValue(decoded.message) : null
  } catch {
    return null
  }
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
    const abort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
