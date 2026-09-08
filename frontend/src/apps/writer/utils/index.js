import router from '@/apps/writer/router'

import { formatSize } from '@/apps/writer/utils/format'
import { nextTick, h } from 'vue'
import { useTimeAgo } from '@vueuse/core'
import editorStyle from '@/apps/writer/styles/editor.css?inline'
import globalStyle from '@/apps/writer/styles/index.css?inline'
import slugify from 'slugify'
import { toast as nToast, createResource } from 'frappe-ui'
import { rootInfo } from '@/apps/drive/sdk'

rootInfo.fetch()
import { createLowlight, common } from 'lowlight'
import { toHtml } from 'hast-util-to-html'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import TurndownService from 'turndown'
import { formatDate } from '@/apps/writer/utils/format'
import { FontSize } from '@/apps/writer/extensions/font-size'
import EmbedExtension from '@/apps/writer/extensions/embed-extension'
import ExtendedParagraph from '@/apps/writer/extensions/extended-paragraph'
import FontFamily from '@/apps/writer/extensions/font-family'
import { cssLineHeight } from '@/apps/writer/utils/typography'

export const prettyData = (entities) => {
  return entities.map((entity) => {
    entity.file_size_pretty = formatSize(entity.file_size)
    entity.relativeModified = useTimeAgo(entity.modified)
    if (entity.accessed) entity.relativeAccessed = useTimeAgo(entity.accessed)
    return entity
  })
}
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
  iframe.setAttribute(
    'style',
    'position: absolute; width: 0; height: 0; top: -10px; left: -10px;',
  )
  document.body.appendChild(iframe)

  const frameWindow = iframe.contentWindow
  const doc =
    iframe.contentDocument ||
    (iframe.contentWindow && iframe.contentWindow.document)

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

function slugger(title) {
  return slugify(title.split('.').join(' '), {
    lower: true,
    trim: true,
    remove: /[^\w\s\']|_/,
  })
}

export async function updateURLSlug(title) {
  const route = router.currentRoute.value
  await nextTick()
  const slug = slugger(title)
  if (route.params.slug !== slug) {
    // Hacky, but we only want to update the URL - triggering a reload breaks a lot
    const base = window.location.pathname.split('/').slice(0, 4).join('/')
    const new_path = base + (base.endsWith('/') ? '' : '/') + slug
    history.replaceState({}, null, new_path)
  }
}

export function dynamicList(k) {
  return k.filter((a) => typeof a !== 'object' || !('cond' in a) || a.cond)
}

export const FONT_FAMILIES = [
  {
    label: 'Caveat',
    key: 'caveat',
    action: (editor) =>
      editor.chain().focus().setFontFamily('var(--font-caveat)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-caveat)',
      }),
  },
  {
    label: 'Comic Sans',
    key: 'comic-sans',
    action: (editor) =>
      editor.chain().focus().setFontFamily('var(--font-comic-sans)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-comic-sans)',
      }),
  },
  {
    label: 'Comfortaa',
    key: 'comfortaa',
    action: (editor) =>
      editor.chain().focus().setFontFamily('var(--font-comfortaa)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-comfortaa)',
      }),
  },
  {
    label: 'EB Garamond',
    key: 'eb-garamond',
    action: (editor) =>
      editor.chain().focus().setFontFamily('var(--font-eb-garamond)').run(),
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
    action: (editor) =>
      editor.chain().focus().setFontFamily('var(--font-geist)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-geist)',
      }),
  },
  {
    label: 'IBM Plex Sans',
    key: 'ibm-plex',
    action: (editor) =>
      editor.chain().focus().setFontFamily('var(--font-ibm-plex)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-ibm-plex)',
      }),
  },
  {
    label: 'Inter',
    key: 'inter',
    action: (editor) =>
      editor.chain().focus().setFontFamily('var(--font-inter)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-inter)',
      }),
  },
  {
    label: 'JetBrains Mono',
    key: 'jetbrains',
    action: (editor) =>
      editor.chain().focus().setFontFamily('var(--font-jetbrains)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-jetbrains)',
      }),
  },
  {
    label: 'Lora',
    key: 'lora',
    action: (editor) =>
      editor.chain().focus().setFontFamily('var(--font-lora)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-lora)',
      }),
  },
  {
    label: 'Merriweather',
    key: 'merriweather',
    action: (editor) =>
      editor.chain().focus().setFontFamily('var(--font-merriweather)').run(),
    isActive: (editor) =>
      editor.isActive('textStyle', {
        fontFamily: 'var(--font-merriweather)',
      }),
  },
  {
    label: 'Nunito',
    key: 'nunito',
    action: (editor) =>
      editor.chain().focus().setFontFamily('var(--font-nunito)').run(),
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

export function toast(obj) {
  if (typeof obj === 'string') return nToast.success(obj)
  const { title, buttons, icon, duration, type } = obj
  nToast.create({
    message: title,
    action: buttons?.[0],
    icon: icon && h(icon, { class: 'text-ink-base' }),
    duration: duration || 5,
    type,
  })
}

export const COMMON_EXTENSIONS = [
  FontSize,
  FontFamily,
  EmbedExtension,
  ExtendedParagraph,
]

export async function downloadMD(editor, foldername) {
  let html = editor.value.getHTML()
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })

  const zip = new JSZip()
  const urls = editor.value.commands.getEmbedUrls()
  const getExtension = createResource({
    url: 'suite.writer.api.docs.get_extension',
  })
  const parent = router.currentRoute.value.params.entityName
  const markdown = turndownService.turndown(html)
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })

  if (urls.length === 0) {
    saveAs(blob, `${foldername}.md`)
    return
  }
  zip.file(`${foldername}.md`, blob)

  for (const i in urls) {
    const ext = await getExtension.fetch({ entity_name: urls[i].name })
    const title = `${urls[i].title}.${ext}`
    html = html.replace(
      `src="/api/method/suite.writer.api.embed.get?id=${urls[i].name}"`,
      `src="./${title}"`,
    )
    const fileUrl = `/api/method/suite.writer.api.embed.get?id=${urls[i].name}`
    const blob = await (await fetch(fileUrl)).blob()
    zip.file(title, blob)
  }

  const blobzip = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
  })

  saveAs(blobzip, `${foldername}.zip`)
}

export function downloadZippedHTML(editor, foldername, settings = {}) {
  nToast.promise(
    (async () => {
      let html = editor.value.getHTML()
      const zip = new JSZip()
      zip.file(`${foldername}.html`, html)
      const urls = editor.value.commands.getEmbedUrls()
      const getExtension = createResource({
        url: 'suite.writer.api.docs.get_extension',
      })

      for (const i in urls) {
        const ext = await getExtension.fetch({ entity_name: urls[i].name })
        const title = `${urls[i].title}.${ext}`
        html = html.replace(
          `src="/api/method/suite.writer.api.embed.get?id=${urls[i].name}"`,
          `src="./${title}"`,
        )
        const fileUrl = `/api/method/suite.writer.api.embed.get?id=${urls[i].name}`
        const blob = await (await fetch(fileUrl)).blob()
        zip.file(title, blob)
      }

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
      })
      saveAs(blob, `${foldername}.zip`)
    })(),
    {
      loading: 'Preparing download...',
      success: 'Download completed!',
      error: 'Download failed',
    },
  )
}

export const insertTemplate = (template, editor) => {
  if (!template.content) return false
  const content = template.content.replaceAll(
    /\{\{(date|time|datetime)\}\}/g,
    (_, type) => formatDate(new Date(), { datetime: type }),
  )
  editor.commands.insertContent(content)
  editor.commands.focus()
  return true
}
