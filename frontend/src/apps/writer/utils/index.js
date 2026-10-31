import { toHtml } from 'hast-util-to-html'
import { common, createLowlight } from 'lowlight'

import EmbedExtension from '@/apps/writer/extensions/embed-extension'
import ExtendedParagraph from '@/apps/writer/extensions/extended-paragraph'
import FontFamily from '@/apps/writer/extensions/font-family'
import { FontSize } from '@/apps/writer/extensions/font-size'
import editorStyle from '@/apps/writer/styles/editor.css?inline'
import globalStyle from '@/apps/writer/styles/index.css?inline'
import { cssLineHeight } from '@/apps/writer/utils/typography'

function highlightCodeBlocks(html) {
  const lowlight = createLowlight(common)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('pre code').forEach((block) => {
    const result = lowlight.highlightAuto(block.textContent)
    block.innerHTML = toHtml(result)
  })

  return doc.body.innerHTML
}

export function printDoc(html, settings = {}) {
  const highlightedHtml = highlightCodeBlocks(html)
  const fontMap = {
    caveat: 'var(--font-caveat)',
    'comic-sans': 'var(--font-comic-sans)',
    comfortaa: 'var(--font-comfortaa)',
    'eb-garamond': 'var(--font-eb-garamond)',
    fantasy: 'fantasy',
    geist: 'var(--font-geist)',
    'ibm-plex': 'var(--font-ibm-plex)',
    inter: 'var(--font-inter)',
    jetbrains: 'var(--font-jetbrains)',
    lora: 'var(--font-lora)',
    merriweather: 'var(--font-merriweather)',
    nunito: 'var(--font-nunito)',
  }
  const fontFamily = fontMap[settings?.font_family]
  // The print document reuses the editor stylesheet, so it needs the same
  // custom properties the editor sets — otherwise paragraphs fall back to the
  // prose defaults and print looser than what is on screen.
  const editorVars = [
    `--editor-font-size: ${settings?.font_size || 15}px`,
    `--editor-line-height: ${cssLineHeight(settings?.line_height)}`,
    `--paragraph-spacing-before: ${settings?.paragraph_spacing_before || 0}px`,
    `--paragraph-spacing-after: ${settings?.paragraph_spacing_after || 0}px`,
  ].join('; ')
  const content = `
            <!DOCTYPE html>
            <html>
              <head>
              <style>${globalStyle}</style>
              <style>${editorStyle}</style>
              <style>
              @page {
                margin: 1.25cm 2.5cm;

                @top-left {
                  content: "${settings?.print_header_left || ''}";  
                  font-family: ${fontFamily};
                  font-size: 10px;  
                  line-height: 1;
                  color: var(--ink-gray-7); 
                  ${settings?.print_header_separator ? ' border-bottom: 0.25pt solid var(--ink-gray-4); margin-bottom: 10px;' : ''}
                }
                @top-right {
                  content: "${settings?.print_header_right || ''}";  
                  font-family: ${fontFamily};
                  font-size: 10px;  
                  line-height: 1;
                  color: var(--ink-gray-7); 
                  ${settings?.print_header_separator ? ' border-bottom: 0.25pt solid var(--ink-gray-4); margin-bottom: 10px;' : ''}
                }
                @bottom-left {  
                  content: "${settings?.print_footer_left || ''}";  
                  font-family: ${fontFamily};
                  font-size: 10px;  
                  line-height: 1;
                  color: var(--ink-gray-7); 
                  ${settings?.print_footer_separator ? 'border-top: 0.25pt solid var(--ink-gray-6); margin-top: 2px;' : ''}
                }
                @bottom-right {  
                  content: ${settings?.print_show_pages ? '"Page " counter(page) " of " counter(pages)' : `"${settings?.print_footer_right || ''}"`};
                  font-family: var(--font-inter);
                  font-size: 10px;
                  line-height: 1;
                  color: var(--ink-gray-7); 
                  ${settings?.print_footer_separator ? 'border-top: 0.25pt solid var(--ink-gray-6); margin-top: 2px;' : ''}
                }
              }
              </style>
              <style>
                .ProseMirror {
                  font-family: ${fontFamily} !important;
                }
                div[data-page-break='true'] {
                  border: none;
                  margin: 0;
                }
              </style>
              </head>
              <body>
                <div class="ProseMirror prose prose-sm prose-v3" style='max-width: ${settings?.wide ? '100ch' : '48rem'}; margin: 0 auto; padding-top: 20px; padding-bottom: 20px; ${editorVars}'>
                  ${highlightedHtml}
                </div>
              </body>
            </html>
          `
  const iframe = document.createElement('iframe')
  iframe.id = 'el-tiptap-iframe'
  iframe.setAttribute('style', 'position: absolute; width: 0; height: 0; top: -10px; left: -10px;')
  document.body.appendChild(iframe)

  const frameWindow = iframe.contentWindow
  const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document)

  if (doc) {
    doc.open()
    doc.write(content)
    doc.close()
  }

  if (frameWindow) {
    iframe.onload = function () {
      try {
        setTimeout(() => {
          frameWindow.focus()
          try {
            if (!frameWindow.document.execCommand('print', false)) {
              frameWindow.print()
            }
          } catch {
            frameWindow.print()
          }
          frameWindow.close()
        }, 500)
      } catch (err) {
        console.error(err)
      }

      setTimeout(function () {
        document.body.removeChild(iframe)
      }, 1000)
    }
  }
}

export function dynamicList(k) {
  return k.filter((a) => typeof a !== 'object' || !('cond' in a) || a.cond)
}

export const FONT_FAMILIES = [
  {
    label: 'Caveat',
    key: 'caveat',
    action: (editor) => editor.chain().focus().setFontFamily('var(--font-caveat)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-caveat)',
      }),
  },
  {
    label: 'Comic Sans',
    key: 'comic-sans',
    action: (editor) => editor.chain().focus().setFontFamily('var(--font-comic-sans)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-comic-sans)',
      }),
  },
  {
    label: 'Comfortaa',
    key: 'comfortaa',
    action: (editor) => editor.chain().focus().setFontFamily('var(--font-comfortaa)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-comfortaa)',
      }),
  },
  {
    label: 'EB Garamond',
    key: 'eb-garamond',
    action: (editor) => editor.chain().focus().setFontFamily('var(--font-eb-garamond)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-eb-garamond)',
      }),
  },
  {
    label: 'Fantasy',
    key: 'fantasy',
    action: (editor) => editor.chain().focus().setFontFamily('fantasy').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'fantasy',
      }),
  },
  {
    label: 'Geist',
    key: 'geist',
    action: (editor) => editor.chain().focus().setFontFamily('var(--font-geist)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-geist)',
      }),
  },
  {
    label: 'IBM Plex Sans',
    key: 'ibm-plex',
    action: (editor) => editor.chain().focus().setFontFamily('var(--font-ibm-plex)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-ibm-plex)',
      }),
  },
  {
    label: 'Inter',
    key: 'inter',
    action: (editor) => editor.chain().focus().setFontFamily('var(--font-inter)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-inter)',
      }),
  },
  {
    label: 'JetBrains Mono',
    key: 'jetbrains',
    action: (editor) => editor.chain().focus().setFontFamily('var(--font-jetbrains)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-jetbrains)',
      }),
  },
  {
    label: 'Lora',
    key: 'lora',
    action: (editor) => editor.chain().focus().setFontFamily('var(--font-lora)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-lora)',
      }),
  },
  {
    label: 'Merriweather',
    key: 'merriweather',
    action: (editor) => editor.chain().focus().setFontFamily('var(--font-merriweather)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-merriweather)',
      }),
  },
  {
    label: 'Nunito',
    key: 'nunito',
    action: (editor) => editor.chain().focus().setFontFamily('var(--font-nunito)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-nunito)',
      }),
  },
]

export function getRandomColor() {
  const letters = '0123456789ABCDEF'
  let color = '#'
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 10)]
  }
  return color
}

function isApple() {
  // Pattern borrowed from TinyKeys library.
  // --
  // https://github.com/jamiebuilds/tinykeys/blob/e0d23b4f248af59ffbbe52411505c3d681c73045/src/tinykeys.ts#L50-L54
  var macOsPattern = /Mac|iPod|iPhone|iPad/

  return macOsPattern.test(window.navigator.platform)
}

export function isModKey(e) {
  return isApple() ? e.metaKey : e.ctrlKey
}

export const COMMON_EXTENSIONS = [FontSize, FontFamily, EmbedExtension, ExtendedParagraph]
