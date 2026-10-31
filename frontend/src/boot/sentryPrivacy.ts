import { redactUrlCredentials } from '@/platform/error-log'

/** Redact URL capabilities in normal telemetry JSON, including nested SDK context. */
export function redactTelemetry(value: unknown): void {
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === 'string') Reflect.set(value, key, redactUrlCredentials(field))
    else redactTelemetry(field)
  }
}
