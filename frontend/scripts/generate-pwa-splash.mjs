/**
 * Regenerates the iOS launch screens in public/pwa/mail/splash.
 *
 * iOS draws nothing of its own for an installed PWA — it only blits an
 * apple-touch-startup-image whose media query matches the device exactly (see
 * setPwaTags in src/router/index.ts), so every device in
 * src/router/pwa-splash-devices.json needs one file per orientation.
 *
 * Renders with headless Chrome, which is what pwa-asset-generator does via
 * puppeteer — done here directly so regenerating does not pull a ~200MB
 * Chromium download into devDependencies.
 *
 *   node scripts/generate-pwa-splash.mjs              # defaults below
 *   node scripts/generate-pwa-splash.mjs --scale 0.25 # smaller logo
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Logo edge as a fraction of the canvas' SHORT edge, so it reads the same in
 *  both orientations and on both phones and tablets. iOS home screen icons sit
 *  near 0.15; a launch mark wants to be bigger than the icon but nowhere near
 *  full bleed. */
const SCALE = Number(argValue('--scale') ?? 0.3)
const BACKGROUND = argValue('--background') ?? '#ffffff'

const LOGO = path.join(root, 'src/assets/app-logos/mail.svg')
const OUT_DIR = path.join(root, 'public/pwa/mail/splash')
const DEVICES = JSON.parse(fs.readFileSync(path.join(root, 'src/router/pwa-splash-devices.json')))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

/** One canvas per device per orientation. Filenames are in physical pixels and
 *  must stay in lockstep with the hrefs setPwaTags builds. */
function canvases() {
  return DEVICES.flatMap(({ device, width, height, dpr }) => {
    const [w, h] = [width * dpr, height * dpr]
    return [
      { name: `apple-splash-${w}-${h}.png`, width: w, height: h, device, orientation: 'portrait' },
      { name: `apple-splash-${h}-${w}.png`, width: h, height: w, device, orientation: 'landscape' },
    ]
  })
}

/**
 * Headless Chrome writes --screenshot and then, when spawned from node, sits
 * there instead of exiting (its helper processes keep it alive), so waiting on
 * exit deadlocks. The file itself is reliable: poll until its size stops
 * growing, then kill the browser.
 */
async function waitForScreenshot(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let previous = -1
  while (Date.now() < deadline) {
    await delay(120)
    if (!fs.existsSync(file)) continue
    const { size } = fs.statSync(file)
    if (size > 0 && size === previous) return
    previous = size
  }
  throw new Error(`Chrome produced no screenshot at ${file} within ${timeoutMs}ms`)
}

async function render(canvas, svg, tmp) {
  // Sizing off the short edge keeps the logo identical between the portrait and
  // landscape file for a given device.
  const size = Math.round(Math.min(canvas.width, canvas.height) * SCALE)
  const html = `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: ${BACKGROUND}; }
  body { width: ${canvas.width}px; height: ${canvas.height}px;
         display: flex; align-items: center; justify-content: center; }
  /* CSS wins over the SVG's own width/height attributes. */
  svg { width: ${size}px; height: ${size}px; display: block; }
</style>${svg}`

  const page = path.join(tmp, 'page.html')
  // Chrome screenshots straight to PNG, which is both lossless and smaller than
  // JPEG for flat-colour artwork like this — so it is also the shipped file.
  const shot = path.join(OUT_DIR, canvas.name)
  fs.writeFileSync(page, html)
  fs.rmSync(shot, { force: true })

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      // Without these Chrome blocks on first-run/profile setup and never
      // reaches the screenshot.
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--virtual-time-budget=2000',
      // Physical pixels: the canvas dimensions are already device pixels.
      '--force-device-scale-factor=1',
      // Never touch the user's live Chrome profile.
      `--user-data-dir=${path.join(tmp, 'profile')}`,
      `--window-size=${canvas.width},${canvas.height}`,
      `--screenshot=${shot}`,
      `file://${page}`,
    ],
    { stdio: 'ignore' },
  )
  try {
    await waitForScreenshot(shot, 60_000)
  } finally {
    chrome.kill('SIGKILL')
    // A killed Chrome leaves its profile lock behind; the next launch reuses
    // this directory and would stall trying to acquire it.
    for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      fs.rmSync(path.join(tmp, 'profile', lock), { force: true })
    }
  }
}

if (!fs.existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}`)
  console.error('Install Google Chrome, or point CHROME at another Chromium build.')
  process.exit(1)
}

const svg = fs.readFileSync(LOGO, 'utf8')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-splash-'))
fs.mkdirSync(OUT_DIR, { recursive: true })

const all = canvases()
console.log(`Rendering ${all.length} launch screens at scale ${SCALE}...`)
try {
  for (const canvas of all) {
    await render(canvas, svg, tmp)
    console.log(`  ${canvas.name.padEnd(28)} ${canvas.device} (${canvas.orientation})`)
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`Done -> ${path.relative(root, OUT_DIR)}`)
