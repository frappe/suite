import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, ref, type App } from 'vue'

import type { LineShape, RectangleShape } from '../canvas/scene'
import type { Shape } from '../canvas/selection'
import ArrowShape from './ArrowShape.vue'
import CanvasMinimap from './CanvasMinimap.vue'

const colorScheme = ref<'light' | 'dark'>('light')
vi.mock('@/platform/theme', () => ({ useTheme: () => ({ resolvedMode: colorScheme }) }))

beforeEach(() => {
  colorScheme.value = 'light'
})

let app: App | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  app?.unmount()
  host?.remove()
})

function mount(render: () => ReturnType<typeof h>) {
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render })
  app.mount(host)
  return host
}

function arrow(stroke?: string | null): LineShape {
  return {
    id: 'arrow',
    kind: 'arrow',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    stroke,
  }
}

async function minimap(shapes: Shape[]) {
  const viewport = reactive({ translationX: 0, translationY: 0, scale: 1 })
  const element = mount(() =>
    h(CanvasMinimap, { shapes, viewport, canvasSize: { x: 800, y: 600 } }),
  )
  viewport.translationX = 1
  await nextTick()
  viewport.translationX = 1000
  await nextTick()
  return element
}

it('renders default arrow ink through the theme while preserving an authored arrowhead', () => {
  const shape = { ...arrow(), arrowHeadFill: '#0070cc' }
  const element = mount(() => h(ArrowShape, { shape, gradientId: 'arrow-test' }))
  const stops = element.querySelectorAll('stop')

  expect(stops[0]?.getAttribute('stop-color')).toBe('var(--draw-ink, var(--ink-gray-9))')
  expect(stops[1]?.getAttribute('stop-color')).toBe('#0070cc')
  expect(shape.stroke).toBeUndefined()
})

it.each([
  ['#171717', '#171717'],
  [null, 'transparent'],
] as const)('keeps an authored or hidden arrow stroke %s unchanged', (stroke, expected) => {
  const element = mount(() => h(ArrowShape, { shape: arrow(stroke), gradientId: 'arrow-test' }))

  expect(
    [...element.querySelectorAll('stop')].map((stop) => stop.getAttribute('stop-color')),
  ).toEqual([expected, expected])
})

it('shows themed default ink, explicit black and hidden strokes distinctly in the overview', async () => {
  const shapes = [
    { ...arrow(), kind: 'line' as const, id: 'default' },
    { ...arrow('#171717'), kind: 'line' as const, id: 'black' },
    { ...arrow(null), kind: 'line' as const, id: 'hidden' },
  ]
  const element = await minimap(shapes)

  expect(
    [...element.querySelectorAll('.minimap-stroke')].map((path) => path.getAttribute('stroke')),
  ).toEqual(['var(--draw-ink, var(--ink-gray-9))', '#171717', 'none'])
  expect(shapes[0]?.stroke).toBeUndefined()
})

it('uses themed overview text defaults and retains explicitly chosen text and label colours', async () => {
  const rectangle: RectangleShape = {
    id: 'label',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    cornerRadius: 0,
    label: 'Default label',
  }
  const element = await minimap([
    rectangle,
    { ...rectangle, id: 'saved-label', label: 'Saved label', labelFill: '#171717' },
    { ...rectangle, id: 'text', kind: 'text', text: 'Default text', fontSize: 16, wrap: false },
    {
      ...rectangle,
      id: 'saved-text',
      kind: 'text',
      text: 'Saved text',
      fontSize: 16,
      wrap: false,
      fill: '#ffffff',
    },
  ])

  expect([...element.querySelectorAll('text')].map((text) => text.getAttribute('fill'))).toEqual([
    'var(--draw-ink, var(--ink-gray-9))',
    '#171717',
    'var(--draw-ink, var(--ink-gray-9))',
    '#ffffff',
  ])
})

it('keeps default overview labels and text readable on authored pastel backgrounds', async () => {
  const rectangle: RectangleShape = {
    id: 'pastel-label',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    cornerRadius: 0,
    label: 'Blue label',
    fill: '#e6f4ff',
  }
  const element = await minimap([
    rectangle,
    { ...rectangle, id: 'green-label', label: 'Green label', fill: '#e4faeb' },
    { ...rectangle, id: 'red-label', label: 'Red label', fill: '#ffe7e7' },
    {
      ...rectangle,
      id: 'pastel-text',
      kind: 'text',
      text: 'Text on blue',
      fontSize: 16,
      wrap: false,
      fill: undefined,
      backgroundColor: '#e6f4ff',
    },
  ])

  expect([...element.querySelectorAll('text')].map((text) => text.getAttribute('fill'))).toEqual([
    '#171717',
    '#171717',
    '#171717',
    '#171717',
  ])
  expect(rectangle.fill).toBe('#e6f4ff')
  expect(rectangle.labelFill).toBeUndefined()
})

it('adapts stored arrow palette colours when the scheme changes without changing the arrow', async () => {
  const shape = { ...arrow('#171717'), arrowHeadFill: '#0070cc' }
  const original = structuredClone(shape)
  const element = mount(() => h(ArrowShape, { shape, gradientId: 'arrow-theme-test' }))
  const renderedColours = () =>
    [...element.querySelectorAll('stop')].map((stop) => stop.getAttribute('stop-color'))

  expect(renderedColours()).toEqual(['#171717', '#0070cc'])
  colorScheme.value = 'dark'
  await nextTick()
  expect(renderedColours()).toEqual(['var(--surface-gray-10)', 'var(--surface-blue-8)'])
  expect(shape).toEqual(original)
  colorScheme.value = 'light'
  await nextTick()
  expect(renderedColours()).toEqual(['#171717', '#0070cc'])
})

it('adapts overview palette fills while preserving custom colours, hidden strokes and image pixels', async () => {
  colorScheme.value = 'dark'
  const rectangle: RectangleShape = {
    id: 'blue-label',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    cornerRadius: 0,
    label: 'Blue label',
    fill: '#e6f4ff',
  }
  const imageSource = 'data:image/png;base64,iVBORw0KGgo='
  const shapes: Shape[] = [
    { ...arrow('#123456'), kind: 'line', id: 'custom-line' },
    { ...arrow(null), kind: 'line', id: 'hidden-line' },
    rectangle,
    {
      ...rectangle,
      id: 'custom-text',
      kind: 'text',
      text: 'Custom dark background',
      fontSize: 16,
      wrap: false,
      fill: undefined,
      backgroundColor: '#123456',
    },
    { ...rectangle, id: 'image', kind: 'image', src: imageSource },
  ]
  const original = structuredClone(shapes)
  const element = await minimap(shapes)

  expect(
    [...element.querySelectorAll('path.minimap-stroke')].map((path) => path.getAttribute('stroke')),
  ).toEqual(['#123456', 'none'])
  expect(element.querySelector('rect.minimap-stroke')?.getAttribute('fill')).toBe(
    'var(--surface-blue-2)',
  )
  expect([...element.querySelectorAll('text')].map((text) => text.getAttribute('fill'))).toEqual([
    'var(--surface-gray-10)',
    '#ffffff',
  ])
  expect(element.querySelector('image')?.getAttribute('href')).toBe(imageSource)
  expect(shapes).toEqual(original)
})
