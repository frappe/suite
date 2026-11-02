export const HOLD_UP_MS = 10_000

// Waits for slow work, but never longer than a person should be held up
export function withinTenSeconds(work: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const tenSeconds = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, HOLD_UP_MS)
  })
  return Promise.race([work, tenSeconds]).finally(() => clearTimeout(timer))
}
