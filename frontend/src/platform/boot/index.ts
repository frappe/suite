/**
 * Values the server sends in the SPA boot (`suite/www/suite.py`). The client
 * reads them from boot only, so a site config change applies on the next page
 * load.
 */

/**
 * The largest file the site accepts, in bytes (Frappe's `max_file_size`).
 * `null` when the boot leaves it out, as the Vite dev page does. The server
 * still refuses a larger file; this only lets a client refuse it sooner.
 */
export function readMaxFileSize(): number | null {
  if (typeof window === 'undefined') return null
  const size = window.max_file_size
  return typeof size === 'number' && Number.isSafeInteger(size) && size > 0 ? size : null
}
