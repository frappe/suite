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
const DEFAULT_RETRY_BASE_MS = 100
const RETRY_BACKOFF_FACTOR = 2
const REQUEST_TIMEOUT_STATUS = 408
const TOO_MANY_REQUESTS_STATUS = 429
export const MIN_SERVER_ERROR_STATUS = 500

export interface BytesTransport extends Transport {
  // Answers every status as it came: the caller reads its own verdicts. Only a
  // network failure throws, and nothing is retried
  requestBytes(
    operation: Operation,
    input: Record<string, unknown>,
    options?: BytesOptions,
  ): Promise<BytesResponse>
}

interface TransportSettings extends Pick<CreateTransportOptions, 'onFailure' | 'onSessionExpired'> {
  fetcher: typeof fetch
  maxRetries: number
  retryBaseMs: number
}

interface PreparedRequest {
  operation: Operation
  url: string
  init: RequestInit
  scope: RequestScope | undefined
  validators: Validators<unknown, unknown> | undefined
  signal: AbortSignal | undefined
}

export function isTransientStatus(status: number): boolean {
  return status === REQUEST_TIMEOUT_STATUS || status === TOO_MANY_REQUESTS_STATUS
}

export function createTransport(options: CreateTransportOptions = {}): BytesTransport {
  const fetcher = options.fetch ?? globalThis.fetch
  if (!fetcher) {
    throw new Error('A fetch implementation is required')
  }

  const settings: TransportSettings = {
    fetcher,
    maxRetries: options.maxRetries ?? DEFAULT_RETRIES,
    retryBaseMs: options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
    onFailure: options.onFailure,
    onSessionExpired: options.onSessionExpired,
  }

  return {
    request(operation, input, requestOptions = {}) {
      return sendRequest(settings, operation, input, requestOptions)
    },

    requestBytes(operation, input, requestOptions = {}) {
      return sendBytes(fetcher, operation, input, requestOptions)
    },
  }
}

async function sendRequest<Input, Output, ErrorType extends string>(
  settings: TransportSettings,
  operation: Operation<Input, Output, ErrorType>,
  input: NoInfer<Input>,
  requestOptions: TransportOptions,
): Promise<Output> {
  const { signal } = requestOptions
  validateOperation(operation)
  const validators: Validators<typeof input, unknown> | undefined =
    await operation.loadValidators?.()
  validators?.validateInput(input)
  operation.validateInput?.(input)
  signal?.throwIfAborted()

  const pathInput = asRecord(input)
  const rawBody = readRawBody(operation, pathInput)
  const url = buildUrl(operation, pathInput)
  const scope = requestOptions.context?.scope() ?? operation.scope?.(input)
  const headers = buildRequestHeaders(scope, requestOptions)
  const init = buildRequestInit(operation, pathInput, rawBody, headers, requestOptions)
  const prepared: PreparedRequest = { operation, url, init, scope, validators, signal }
  const output = await sendWithRetries(settings, prepared)
  return output as Output
}

function readRawBody(operation: Operation, pathInput: Record<string, unknown>): Blob | undefined {
  if (!operation.body) {
    return undefined
  }

  const rawBody = pathInput[operation.body]
  if (!(rawBody instanceof Blob)) {
    throw new TypeError(`Operation input field ${operation.body} must be a Blob`)
  }

  return rawBody
}

function buildRequestHeaders(
  scope: RequestScope | undefined,
  requestOptions: TransportOptions,
): Headers {
  const headers = new Headers(scope?.headers)
  for (const [name, value] of new Headers(requestOptions.headers)) {
    headers.set(name, value)
  }

  headers.set('Accept', 'application/json')
  setCsrfHeader(headers)
  return headers
}

function buildRequestInit(
  operation: Operation,
  pathInput: Record<string, unknown>,
  rawBody: Blob | undefined,
  headers: Headers,
  requestOptions: TransportOptions,
): RequestInit {
  const init: RequestInit = {
    method: operation.method,
    headers,
    credentials: 'same-origin',
    signal: requestOptions.signal,
    keepalive: requestOptions.keepalive,
  }
  if (rawBody) {
    headers.set('Content-Type', 'application/octet-stream')
    init.body = rawBody
  } else if (operation.method !== 'GET' && operation.method !== 'DELETE') {
    headers.set('Content-Type', 'application/json; charset=utf-8')
    const omittedParams = (operation.pathParams ?? []).concat(operation.localParams ?? [])
    const bodyInput = withoutPathParams(pathInput, omittedParams)
    init.body = JSON.stringify(bodyInput)
  }

  return init
}

async function sendWithRetries(
  settings: TransportSettings,
  prepared: PreparedRequest,
): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const canRetry = isQuery(prepared.operation) && attempt < settings.maxRetries
    const backoffMs = settings.retryBaseMs * RETRY_BACKOFF_FACTOR ** attempt
    const response = await fetchAttempt(settings, prepared, canRetry)
    if (response === null) {
      await delay(backoffMs, prepared.signal)
      continue
    }

    const body = await readAnsweredBody(prepared, response)
    if (response.ok) {
      return acceptOutput(prepared, body)
    }

    const retryAfter = readRetryAfter(response)
    const error = decodeFailure(settings, response, body, retryAfter)
    if (!canRetry || !isRetryableStatus(response.status)) {
      throw recordFailure(settings, prepared.scope, new TransportError(error))
    }

    await delay(retryAfter ?? backoffMs, prepared.signal)
  }
}

async function fetchAttempt(
  settings: TransportSettings,
  prepared: PreparedRequest,
  canRetry: boolean,
): Promise<Response | null> {
  const { fetcher } = settings
  try {
    return await fetcher(prepared.url, prepared.init)
  } catch (cause) {
    if (isAbort(cause)) {
      throw cause
    }

    if (!canRetry) {
      throw recordFailure(settings, prepared.scope, toNetworkError(cause))
    }

    return null
  }
}

async function readAnsweredBody(prepared: PreparedRequest, response: Response): Promise<unknown> {
  prepared.signal?.throwIfAborted()
  const body = await readResponseBody(prepared.operation, response)
  prepared.signal?.throwIfAborted()
  return body
}

function readResponseBody(operation: Operation, response: Response): Promise<unknown> {
  if (response.ok && operation.bytes) {
    return response.blob()
  }

  return readBody(response)
}

function acceptOutput(prepared: PreparedRequest, body: unknown): unknown {
  const output = decodeOutput(prepared.operation, body)
  prepared.validators?.validateOutput(output)
  prepared.operation.validateOutput?.(output)
  prepared.scope?.settled?.({ ok: true, output })
  return output
}

function decodeOutput(operation: Operation, body: unknown): unknown {
  const isEmpty =
    operation.empty &&
    isRecord(body) &&
    Object.keys(body).every((key) => key === 'docs' || key === '_server_messages')
  if (isEmpty) {
    return null
  }

  return decodeSuccess(body, operation.envelope)
}

function readRetryAfter(response: Response): number | null {
  if (response.status !== TOO_MANY_REQUESTS_STATUS) {
    return null
  }

  return parseRetryAfter(response.headers.get('Retry-After'))
}

function decodeFailure(
  settings: TransportSettings,
  response: Response,
  body: unknown,
  retryAfter: number | null,
): PlatformError {
  const error = decodeError(body, response.status, response.statusText)
  if (retryAfter !== null) {
    error.retryAfterMs = retryAfter
  }

  if (error.type === 'SessionExpired') {
    settings.onSessionExpired?.(error as PlatformError<'SessionExpired'>)
  }

  return error
}

function isQuery(operation: Operation): boolean {
  return operation.kind === 'query' || (operation.kind === undefined && operation.method === 'GET')
}

function isRetryableStatus(status: number): boolean {
  return status >= MIN_SERVER_ERROR_STATUS || status === TOO_MANY_REQUESTS_STATUS
}

function recordFailure(
  settings: TransportSettings,
  scope: RequestScope | undefined,
  error: TransportError,
): TransportError {
  scope?.settled?.({ ok: false, error })
  settings.onFailure?.(error)
  return error
}

function toNetworkError(cause: unknown): TransportError {
  const failure = {
    type: 'NetworkError',
    message: networkMessage(cause),
    status: 0,
  }
  return new TransportError(failure)
}

async function sendBytes(
  fetcher: typeof fetch,
  operation: Operation,
  input: Record<string, unknown>,
  requestOptions: BytesOptions,
): Promise<BytesResponse> {
  validateOperation(operation)
  const url = buildUrl(operation, input)
  const init = buildBytesInit(operation, requestOptions)

  let response: Response
  try {
    response = await fetcher(url, init)
  } catch (cause) {
    if (isAbort(cause)) {
      throw cause
    }

    throw toNetworkError(cause)
  }

  const body = await response.arrayBuffer()
  return {
    status: response.status,
    headers: response.headers,
    bytes: new Uint8Array(body),
  }
}

function buildBytesInit(operation: Operation, requestOptions: BytesOptions): RequestInit {
  const headers = new Headers(requestOptions.headers)
  headers.set('Accept', 'application/octet-stream, application/json')
  setCsrfHeader(headers)

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

  return init
}

function setCsrfHeader(headers: Headers): void {
  const csrf = readCsrfToken()
  if (csrf) {
    headers.set('X-Frappe-CSRF-Token', csrf)
  }
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
