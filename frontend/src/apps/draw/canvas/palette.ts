const families: [name: string, base: string, ...shades: string[]][] = [
  ['Gray', '#383838', '#f3f3f3', '#e2e2e2', '#999999', '#525252', '#171717'],
  ['Blue', '#0289f7', '#e6f4ff', '#a7d7fd', '#0289f7', '#0070cc', '#004880'],
  ['Green', '#30a66d', '#e4faeb', '#b9eecc', '#59ba8b', '#278f5e', '#173b2c'],
  ['Red', '#e03636', '#ffe7e7', '#fdc2c2', '#e03636', '#b52a2a', '#6b1515'],
  ['Orange', '#e86c13', '#ffefe4', '#ffcba3', '#e86c13', '#bd3e0c', '#6b2711'],
  ['Yellow', '#edba13', '#fff7d3', '#f5e171', '#edba13', '#ab6e05', '#733f12'],
  ['Purple', '#9c45e3', '#f6e9ff', '#e2b9fc', '#9c45e3', '#6e399d', '#401863'],
  ['Pink', '#e34aa6', '#fde8f5', '#f9b9e0', '#e34aa6', '#9c2671', '#570f3e'],
  ['Teal', '#36baad', '#e6f7f4', '#97ded4', '#36baad', '#0f736b', '#114541'],
  ['Cyan', '#3bbde5', '#ddf7ff', '#99e2f8', '#3bbde5', '#267a94', '#164759'],
  ['Amber', '#e79913', '#fdf8ed', '#fbdb73', '#e79913', '#b35309', '#763813'],
  ['Violet', '#6846e3', '#f0ebff', '#c9bafb', '#6846e3', '#4f3da1', '#251959'],
  ['Lime', '#8db20c', '#f3fadf', '#dfeeb2', '#a9cf4d', '#6f8b0a', '#374505'],
  ['Brown', '#9a624a', '#f7eee9', '#e8c8b8', '#b97c62', '#744532', '#3d2117'],
  ['Rose', '#e6577a', '#ffeaef', '#ffc4d2', '#e6577a', '#b73455', '#651526'],
]

export const DRAW_PALETTE = families.map(([name, base, ...shades]) => ({ name, base, shades }))

// These families do not have corresponding surface tokens.
const customFamilies = new Set(['Lime', 'Brown', 'Rose'])
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
    if (customFamilies.has(family.name)) {
      return `oklch(from ${normalized} clamp(0.24, calc(1.18 - l), 0.96) c h)`
    }
    const step = shadeIndex >= 0 ? surfaceSteps[shadeIndex] : family.name === 'Gray' ? 9 : 6
    return `var(--surface-${family.name.toLowerCase()}-${step})`
  }
  return color
}
