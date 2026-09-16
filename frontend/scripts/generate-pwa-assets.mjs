/**
 * Regenerates the suite PWA's artwork in public/pwa/suite: the home-screen
 * icons and the iOS launch screens, all from the suite logo.
 *
 * The icons are the logo at full bleed over its own brand colour — the
 * maskable pair Chrome and Android cut to their shapes, and the 180 iOS reads
 * from apple-touch-icon and rounds itself.
 *
 * iOS draws nothing of its own for an installed PWA's launch — it only blits
 * an apple-touch-startup-image whose media query matches the device exactly
 * (see setPwaTags in src/router/index.ts), so every device in
 * src/router/pwa-splash-devices.json needs one file per orientation.
 *
 * Renders with headless Chrome, which is what pwa-asset-generator does via
 * puppeteer — done here directly so regenerating does not pull a ~200MB
 * Chromium download into devDependencies.
 *
 *   node scripts/generate-pwa-assets.mjs              # defaults below
 *   node scripts/generate-pwa-assets.mjs --scale 0.25 # smaller launch logo
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

const LOGO = path.join(root, 'src/assets/app-logos/suite.svg')
const OUT_DIR = path.join(root, 'public/pwa/suite')
const SPLASH_DIR = path.join(OUT_DIR, 'splash')

/** The icons: the logo drawn edge to edge over the colour of its own rounded
 *  square, so the corners the square leaves are the same colour and the
 *  platform's mask decides the shape. The colour is read off the logo. */
const ICONS = [
  { name: 'icon-512.maskable.png', size: 512 },
  { name: 'icon-192.maskable.png', size: 192 },
  { name: 'apple-icon-180.png', size: 180 },
]
const DEVICES = JSON.parse(fs.readFileSync(path.join(root, 'src/router/pwa-splash-devices.json')))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

/** One launch canvas per device per orientation. Filenames are in physical
 *  pixels and must stay in lockstep with the hrefs setPwaTags builds. The logo
 *  is sized off the short edge, so it is identical between the portrait and
 *  landscape file for a given device. */
function splashCanvases() {
  return DEVICES.flatMap(({ device, width, height, dpr }) => {
    const [w, h] = [width * dpr, height * dpr]
    const logo = Math.round(Math.min(w, h) * SCALE)
    const canvas = (file, width, height, orientation) => ({
      file: path.join(SPLASH_DIR, file), width, height, logo, background: BACKGROUND,
      label: `${device} (${orientation})`,
    })
    return [
      canvas(`apple-splash-${w}-${h}.png`, w, h, 'portrait'),
      canvas(`apple-splash-${h}-${w}.png`, h, w, 'landscape'),
    ]
  })
}

function iconCanvases(brandColor) {
  return ICONS.map(({ name, size }) => ({
    file: path.join(OUT_DIR, name), width: size, height: size, logo: size,
    background: brandColor, label: 'icon',
  }))
}

/** The first solid fill in the logo is its rounded square's. */
function brandColorOf(svg) {
  const match = svg.match(/fill="(#[0-9a-fA-F]{6})"/)
  if (!match) throw new Error(`No solid fill found in ${LOGO}`)
  return match[1]
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
  const html = `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: ${canvas.background}; }
  body { width: ${canvas.width}px; height: ${canvas.height}px;
         display: flex; align-items: center; justify-content: center; }
  /* CSS wins over the SVG's own width/height attributes. */
  svg { width: ${canvas.logo}px; height: ${canvas.logo}px; display: block; }
</style>${svg}`

  const page = path.join(tmp, 'page.html')
  // Chrome screenshots straight to PNG, which is both lossless and smaller than
  // JPEG for flat-colour artwork like this — so it is also the shipped file.
  const shot = canvas.file
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-assets-'))
fs.mkdirSync(SPLASH_DIR, { recursive: true })

const all = [...iconCanvases(brandColorOf(svg)), ...splashCanvases()]
console.log(`Rendering ${ICONS.length} icons and ${all.length - ICONS.length} launch screens at scale ${SCALE}...`)
try {
  for (const canvas of all) {
    await render(canvas, svg, tmp)
    console.log(`  ${path.relative(OUT_DIR, canvas.file).padEnd(35)} ${canvas.label}`)
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`Done -> ${path.relative(root, OUT_DIR)}`)
