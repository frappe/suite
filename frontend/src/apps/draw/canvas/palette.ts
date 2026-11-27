export type PaletteFamily = { name: string; base: string; shades: string[] }

export const DRAW_PALETTE: PaletteFamily[] = [
  {
    name: 'Gray',
    base: '#383838',
    shades: ['#f3f3f3', '#e2e2e2', '#999999', '#525252', '#171717'],
  },
  {
    name: 'Blue',
    base: '#0289f7',
    shades: ['#e6f4ff', '#a7d7fd', '#0289f7', '#0070cc', '#004880'],
  },
  {
    name: 'Green',
    base: '#30a66d',
    shades: ['#e4faeb', '#b9eecc', '#59ba8b', '#278f5e', '#173b2c'],
  },
  { name: 'Red', base: '#e03636', shades: ['#ffe7e7', '#fdc2c2', '#e03636', '#b52a2a', '#6b1515'] },
  {
    name: 'Orange',
    base: '#e86c13',
    shades: ['#ffefe4', '#ffcba3', '#e86c13', '#bd3e0c', '#6b2711'],
  },
  {
    name: 'Yellow',
    base: '#edba13',
    shades: ['#fff7d3', '#f5e171', '#edba13', '#ab6e05', '#733f12'],
  },
  {
    name: 'Purple',
    base: '#9c45e3',
    shades: ['#f6e9ff', '#e2b9fc', '#9c45e3', '#6e399d', '#401863'],
  },
  {
    name: 'Pink',
    base: '#e34aa6',
    shades: ['#fde8f5', '#f9b9e0', '#e34aa6', '#9c2671', '#570f3e'],
  },
  {
    name: 'Teal',
    base: '#36baad',
    shades: ['#e6f7f4', '#97ded4', '#36baad', '#0f736b', '#114541'],
  },
  {
    name: 'Cyan',
    base: '#3bbde5',
    shades: ['#ddf7ff', '#99e2f8', '#3bbde5', '#267a94', '#164759'],
  },
  {
    name: 'Amber',
    base: '#e79913',
    shades: ['#fdf8ed', '#fbdb73', '#e79913', '#b35309', '#763813'],
  },
  {
    name: 'Violet',
    base: '#6846e3',
    shades: ['#f0ebff', '#c9bafb', '#6846e3', '#4f3da1', '#251959'],
  },
  {
    name: 'Lime',
    base: '#8db20c',
    shades: ['#f3fadf', '#dfeeb2', '#a9cf4d', '#6f8b0a', '#374505'],
  },
  {
    name: 'Brown',
    base: '#9a624a',
    shades: ['#f7eee9', '#e8c8b8', '#b97c62', '#744532', '#3d2117'],
  },
  {
    name: 'Rose',
    base: '#e6577a',
    shades: ['#ffeaef', '#ffc4d2', '#e6577a', '#b73455', '#651526'],
  },
]

const semanticFamilies = new Set([
  'Gray',
  'Blue',
  'Green',
  'Red',
  'Orange',
  'Yellow',
  'Purple',
  'Pink',
  'Teal',
  'Cyan',
  'Amber',
  'Violet',
])
const surfaceSteps = [2, 4, 6, 8, 10]

export function paletteColor(
  color: string | undefined,
  dark: boolean,
  usage: 'ink' | 'fill' = 'ink',
): string | undefined {
  if (!dark || color === undefined) return color
  const normalized = color.toLowerCase()
  if (usage === 'fill' && (normalized === '#fff' || normalized === '#ffffff')) {
    return 'var(--surface-base)'
  }
  if (normalized === '#000' || normalized === '#000000') return 'var(--surface-gray-10)'

  for (const family of DRAW_PALETTE) {
    const shadeIndex = family.shades.indexOf(normalized)
    if (family.base !== normalized && shadeIndex < 0) continue
    if (!semanticFamilies.has(family.name)) {
      return `oklch(from ${normalized} clamp(0.24, calc(1.18 - l), 0.96) c h)`
    }
    const step = shadeIndex >= 0 ? surfaceSteps[shadeIndex] : family.name === 'Gray' ? 9 : 6
    return `var(--surface-${family.name.toLowerCase()}-${step})`
  }
  return color
}
