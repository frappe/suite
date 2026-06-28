import router from '@/apps/writer/router'

import { useSessionStore } from '@/boot/session'
import { formatSize } from '@/apps/writer/utils/format'
import { nextTick, h } from 'vue'
import { useTimeAgo } from '@vueuse/core'
import { set } from 'idb-keyval'
import editorStyle from '@/apps/writer/styles/editor.css?inline'
import globalStyle from '@/apps/writer/styles/index.css?inline'
import slugify from 'slugify'
import { useFileUpload, toast as nToast, createResource } from 'frappe-ui'
import { getTeams } from '@/apps/drive/ui/drive/js/resources'
import emitter from '@/apps/writer/emitter'
import { createLowlight, common } from 'lowlight'
import { toHtml } from 'hast-util-to-html'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import TurndownService from 'turndown'
import { formatDate } from '@/apps/writer/utils/format'
import {
  default as TableOfContents,
  getHierarchicalIndexes,
} from '@tiptap/extension-table-of-contents'
import { FontSize } from '@/apps/writer/extensions/font-size'
import EmbedExtension from '@/apps/writer/extensions/embed-extension'
import ExtendedParagraph from '@/apps/writer/extensions/extended-paragraph'
import FontFamily from '@/apps/writer/extensions/font-family'

function trimCommonPrefix(a, b) {
  let i = 0
  while (i < a.length && i < b.length && !/^\d+$/.test(a[i]) && a[i] === b[i])
    i++
  return [
    a.slice(i).split(/[\W]/)[0].toLowerCase(),
    b.slice(i).split(/[\W]/)[0].toLowerCase(),
  ]
}

function extractNum(name) {
  const match = name.match(/^(.*?)(\d+)(\D*)$/)
  if (!match) return 0
  return parseInt(match[2], 10)
}

export const groupByFolder = (entities) => {
  return {
    Folders: entities.filter((x) => x.is_folder === 1),
    Files: entities.filter((x) => x.is_folder === 0),
  }
}

export const prettyData = (entities) => {
  return entities.map((entity) => {
    entity.file_size_pretty = formatSize(entity.file_size)
    entity.relativeModified = useTimeAgo(entity.modified)
    if (entity.accessed) entity.relativeAccessed = useTimeAgo(entity.accessed)
    return entity
  })
}
export const setBreadCrumbs = (entity) => {
  const breadcrumbs = entity.breadcrumbs
  const in_home = entity.in_home
  let res = [
    {
      label: __('Shared'),
      name: 'Shared',
      route: useSessionStore().isLoggedIn && '/shared',
    },
  ]
  const team = getTeams.data?.[breadcrumbs[0].team]
  if (team || in_home)
    res = [
      {
        label: in_home ? __('Home') : team.title,
        name: in_home ? 'Home' : team.name,
        route: in_home
          ? { name: 'Home' }
          : { name: 'Team', params: { team: team.name } },
      },
    ]

  if (!breadcrumbs[0].folder) breadcrumbs.splice(0, 1)
  const popBreadcrumbs = (item) => () =>
    res.splice(res.findIndex((k) => k.name === item.name) + 1)

  breadcrumbs.forEach((folder, idx) => {
    const final = idx === breadcrumbs.length - 1
    res.push({
      label: folder.file_name,
      name: folder.name,
      onClick: final
        ? () => entity.write && emitter.emit('rename')
        : popBreadcrumbs(folder),
      route: final
        ? null
        : { name: 'Folder', params: { entityName: folder.name } },
    })
  })
}

export const MIME_LIST_MAP = {
  Folder: [],
  Image: [
    'image/png',
    'image/jpeg',
    'image/svg+xml',
    'image/heic',
    'image/heif',
    'image/avif',
    'image/webp',
    'image/tiff',
    'image/gif',
  ],
  PDF: ['application/pdf'],
  'After Effects': ['application/vnd.adobe.aftereffects.project'],
  Photoshop: ['application/photoshop'],
  Code: [
    'text/x-python',
    'text/x-shellscript',
    'application/x-httpd-php',
    'application/x-python-script',
    'application/x-sql',
    'text/html',
    'text/css',
    'text/javascript',
    'application/javascript',
  ],
  Sketch: ['application/sketch'],
  Markdown: ['text/markdown'],
  Text: [
    'text/plain',

    'text/rich-text',
    'application/json',

    'text/x-perl',
    'text/x-csrc',
    'text/x-sh',
  ],
  'XML Data': ['application/xml'],
  Document: [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.apple.pages',
    'application/x-abiword',
    'frappe_doc',
  ],
  Spreadsheet: [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv',
    'application/vnd.apple.numbers',
  ],
  Presentation: [
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.presentation',
    'application/vnd.apple.keynote',
  ],
  Audio: [
    'audio/mpeg',
    'audio/wav',
    'audio/x-midi',
    'audio/ogg',
    'audio/mp4',
    'audio/mp3',
  ],
  Video: [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    'video/x-matroska',
  ],
  Book: ['application/epub+zip', 'application/x-mobipocket-ebook'],
  Application: [
    'application/octet-stream',
    'application/x-sh',
    'application/vnd.microsoft.portable-executable',
  ],
  Archive: [
    'application/zip',
    'application/x-rar-compressed',
    'application/x-tar',
    'application/gzip',
    'application/x-bzip2',
  ],
}

// Synced cache - ensure all setters are reflected in the app
function getCacheKey(cacheKey) {
  if (!cacheKey) {
    return null
  }
  if (typeof cacheKey === 'string') {
    cacheKey = [cacheKey]
  }
  return JSON.stringify(cacheKey)
}
export function setCache(t, cache) {
  t.setData = async (data) => {
    if (typeof data === 'function') {
      t.data = data(t.data)
    } else {
      t.data = data
    }
    await set(getCacheKey(cache), JSON.stringify(t.data))
  }
}

export function enterFullScreen() {
  let elem = document.getElementById('renderContainer')
  if (elem.requestFullscreen) {
    elem.requestFullscreen()
  } else if (elem.mozRequestFullScreen) {
    /* Firefox */
    elem.mozRequestFullScreen()
  } else if (elem.webkitRequestFullscreen) {
    /* Chrome, Safari & Opera */
    elem.webkitRequestFullscreen()
  } else if (elem.msRequestFullscreen) {
    /* IE/Edge */
    elem.msRequestFullscreen()
  }
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
  const applyWatermark = settings?.apply_watermark || false
  const watermark = {
    text: settings?.watermark_text || '',
    size: settings?.watermark_size || 90,
    angle: settings?.watermark_angle || -45,
  }
  const shouldShowWatermark = applyWatermark && watermark.text.trim() !== ''
  const content = `
            <!DOCTYPE html>
            <html>
              <head>
              <style>${globalStyle}</style>
              <style>${editorStyle}</style>
              <style>
              @page {
                margin: 1.25cm 0.5cm;
                
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
                  margin: none;
                }  
                .watermark {
                  position: fixed;
                  top: 50%;
                  left: 50%;
                  transform: translate(-50%, -50%) rotate(${watermark.angle}deg);
                  opacity: 0.12;
                  font-size: ${watermark.size}px;
                  color: #999;
                  pointer-events: none;
                  z-index: 9999;
                  white-space: nowrap;
                }
              </style>
              </head>
              <body>
                ${shouldShowWatermark ? `<div class="watermark">${watermark.text}</div>` : ''}
                <div class="ProseMirror prose-sm" style='padding-left: 40px; padding-right: 40px; padding-top: 20px; padding-bottom: 20px; margin: 0;'>
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

function getLinkStem(entity) {
  return `${
    {
      true: 'f',
      [new Boolean(entity.is_folder)]: 'd',
    }[true]
  }/${entity.name}/${slugger(entity.file_name)}`
}

const copyToClipboard = (str) => {
  if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(str)
  } else {
    // Fallback to the legacy clipboard API
    const textArea = document.createElement('textarea')
    textArea.value = str
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
    return Promise.resolve()
  }
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

export function getLink(entity, copy = true, withDomain = true) {
  let link
  if (entity.file_type === 'Link') link = entity.file_url
  else if (entity.mime_type === 'frappe/slides') {
    link = window.location.origin + '/slides/presentation/' + entity.name
  } else {
    link = `${withDomain ? window.location.origin + '/drive' : ''}/${getLinkStem(entity)}`
  }
  if (!copy) return link
  try {
    copyToClipboard(link).then(() => toast('Copied to your clipboard.'))
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      toast({
        icon: 'alert-triangle',
        iconClasses: 'text-red-700',
        title: 'Clipboard permission denied',
        position: 'bottom-right',
      })
    } else {
      console.error('Failed to copy link:', err)
    }
  }
}

export function dynamicList(k) {
  return k.filter((a) => typeof a !== 'object' || !('cond' in a) || a.cond)
}

export const setTitle = (title) =>
  (document.title =
    (router.currentRoute.value.name === 'Folder' ? 'Folder - ' : '') + title)

async function uploadImage(file, params) {
  const uploader = useFileUpload()
  const upload = uploader.upload(file, {
    params,
    upload_endpoint: '/api/method//api/method/suite.drive.api.files.upload_file',
  })
  let entity = await new Promise((resolve) => {
    upload.then((data) => {
      resolve(data)
    })
  })

  return entity
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

export const COMMON_EXTENSIONS = [EmbedExtension, ExtendedParagraph]

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

export const formatShortcut = (sequence) => {
  if (!sequence) return ''
  const isMac = navigator.platform.toUpperCase().includes('MAC')
  const parts = sequence.split('-')
  return parts
    .map((part) => {
      switch (part.toLowerCase()) {
        case 'meta':
          return isMac ? '⌘' : 'Win'
        case 'ctrl':
          return isMac ? '⌃' : 'Ctrl'
        case 'alt':
          return isMac ? '⌥' : 'Alt'
        case 'shift':
          return isMac ? '⇧' : 'Shift'
        default:
          return part.toUpperCase()
      }
    })
    .join(isMac ? '' : '+')
}
