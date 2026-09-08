import { Extension } from '@tiptap/core'

type StyleValidator = (value: string) => boolean
type StyleNormalizer = (value: string) => string | null

interface CleanStylesOptions {
  /**
   * Validators per CSS property.
   * Return false → property is removed.
   */
  validators?: Record<string, StyleValidator>

  /**
   * Normalizers per CSS property.
   * Return null → property is removed.
   * Return string → replaced value.
   */
  normalizers?: Record<string, StyleNormalizer>

  /**
   * Called for every property before validators.
   * Return false → property is removed.
   */
  allowProperty?: (property: string, value: string) => boolean
}

function parseStyle(style: string): Map<string, string> {
  const map = new Map<string, string>()

  style
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [key, ...rest] = entry.split(':')
      if (!key || rest.length === 0) return
      map.set(key.trim(), rest.join(':').trim())
    })

  return map
}

function serializeStyle(map: Map<string, string>): string {
  return Array.from(map.entries())
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ')
}

const CleanStyles = Extension.create<CleanStylesOptions>({
  name: 'cleanStyles',

  addOptions() {
    return {
      validators: {},
      normalizers: {},
      allowProperty: () => true,
    }
  },

  addCommands() {
    return {
      cleanStyles:
        () =>
        ({ state, tr, dispatch }) => {
          const { doc, schema } = state
          const textStyleType = schema.marks.textStyle
          doc.descendants((node, pos) => {
            const styleMark = node.marks.filter(
              (mark) => mark.type.name === textStyleType.name,
            )?.[0]

            for (let [key, validator] of Object.entries(this.options.validators)) {
              const value = node.attrs[key]
              if (value && !validator(`${value}`)) {
                delete node.attrs[key]
                tr.setNodeMarkup(pos, undefined, node.attrs)
              }
              if (styleMark) {
                const value = styleMark.attrs[key]
                if (value && !validator(`${value}`)) {
                  const nextAttrs = { ...node.attrs }
                  delete nextAttrs[key]
                  const from = pos
                  const to = pos + node.nodeSize
                  tr.removeMark(from, to, textStyleType)
                  if (Object.keys(node.attrs).length) {
                    tr.addMark(from, to, textStyleType.create(node.attrs))
                  }
                }
              }
            }
          })

          if (tr.steps.length) {
            dispatch?.(tr)
          }

          return true
        },
    }
  },
})

export default CleanStyles
