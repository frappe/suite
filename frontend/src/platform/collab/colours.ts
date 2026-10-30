// One mode's shades of a person's colour: solid for their caret and dot, tint behind their name, ink for the
// name's text, and their selection
interface Shades {
  solid: string
  tint: string
  ink: string
  selection: string
}

export interface PeerColour {
  light: Shades
  dark: Shades
}

function shades(solid: string, tint: string, ink: string, selection: string): Shades {
  return { solid, tint, ink, selection }
}

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

// Neighbours differ in hue, so a clash moves a person to a colour that reads apart
export const PALETTE: PeerColour[] = [
  {
    light: shades('#0090ff', '#e6f4fe', '#0d70c7', 'rgba(0, 144, 255, .16)'),
    dark: shades('#3b9eff', '#0d2847', '#70b8ff', 'rgba(59, 158, 255, .24)'),
  },
  {
    light: shades('#e54d2e', '#feebe7', '#cc3315', 'rgba(229, 77, 46, .16)'),
    dark: shades('#ec6142', '#391714', '#ff977d', 'rgba(236, 97, 66, .22)'),
  },
  {
    light: shades('#12a594', '#e0f8f3', '#007d6c', 'rgba(18, 165, 148, .16)'),
    dark: shades('#0bd8b6', '#0d2d2a', '#0bd8b6', 'rgba(11, 216, 182, .2)'),
  },
  {
    light: shades('#6e56cf', '#f4f0fe', '#6550b9', 'rgba(110, 86, 207, .16)'),
    dark: shades('#7d66d9', '#291f43', '#baa7ff', 'rgba(125, 102, 217, .22)'),
  },
  {
    light: shades('#f76b15', '#ffefd6', '#bd4800', 'rgba(247, 107, 21, .16)'),
    dark: shades('#ff801f', '#331e0b', '#ffa057', 'rgba(255, 128, 31, .22)'),
  },
  {
    light: shades('#00a2c7', '#def7f9', '#0f7892', 'rgba(0, 162, 199, .16)'),
    dark: shades('#23afd0', '#082c36', '#4ccce6', 'rgba(35, 175, 208, .22)'),
  },
  {
    light: shades('#d6409f', '#fee9f5', '#c2298a', 'rgba(214, 64, 159, .14)'),
    dark: shades('#e66aae', '#3a1530', '#ff8dcc', 'rgba(230, 106, 174, .22)'),
  },
  {
    light: shades('#46a758', '#e9f6e9', '#2a7e3b', 'rgba(70, 167, 88, .16)'),
    dark: shades('#53b365', '#1b2a1e', '#71d083', 'rgba(83, 179, 101, .22)'),
  },
  {
    light: shades('#ab4aba', '#fbebfb', '#953ea3', 'rgba(171, 74, 186, .16)'),
    dark: shades('#b658c4', '#351a35', '#e796f3', 'rgba(182, 88, 196, .22)'),
  },
  {
    light: shades('#ad7f58', '#f6eee7', '#815e46', 'rgba(173, 127, 88, .16)'),
    dark: shades('#b88c67', '#262220', '#dbb594', 'rgba(184, 140, 103, .22)'),
  },
]

// FNV-1a, so a person's colour is the same in every tab and session
function hashed(key: string) {
  let hash = FNV_OFFSET
  for (const char of key) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, FNV_PRIME)
  }

  return hash >>> 0
}

// Each person in rank order takes their own colour, or the next free one once someone ranked earlier has it
export function assignColours(people: string[]) {
  const taken = new Set<number>()
  const colours = new Map<string, PeerColour>()
  for (const person of people) {
    let index = hashed(person) % PALETTE.length
    while (taken.has(index) && taken.size < PALETTE.length) {
      index = (index + 1) % PALETTE.length
    }

    taken.add(index)
    colours.set(person, PALETTE[index])
  }

  return colours
}

// The colour as CSS custom properties; the `peer-colour` class picks the light or dark shades
export function colourStyle({ light, dark }: PeerColour) {
  return {
    '--peer-light': light.solid,
    '--peer-light-tint': light.tint,
    '--peer-light-ink': light.ink,
    '--peer-light-selection': light.selection,
    '--peer-dark': dark.solid,
    '--peer-dark-tint': dark.tint,
    '--peer-dark-ink': dark.ink,
    '--peer-dark-selection': dark.selection,
  }
}
