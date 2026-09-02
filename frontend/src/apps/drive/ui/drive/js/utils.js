import { toast } from 'frappe-ui'
import slugify from 'slugify'
import { useTimeAgo } from '@vueuse/core'

import router from '@/apps/drive/router'

import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(localizedFormat)

export function dynamicList(k) {
  return k.filter((a) => typeof a !== 'object' || !('cond' in a) || a.cond)
}

export function getFileLink(entity, copy = true) {
  let link
  if (entity.file_type === 'Link') link = entity.file_url
  else if (entity.content_doctype === 'Presentation') {
    link = `${window.location.origin}/slides/presentation/${entity.content_docname}`
  } else if (entity.file_type === 'Document' || entity.file_type === 'Markdown') {
    link = `${window.location.origin}/writer/w/${entity.name}`
  } else {
    link = `${window.location.origin}/drive/${getLinkStem(entity)}`
  }
  if (!copy) return link
  try {
    copyToClipboard(link).then(() => toast.success('Copied to your clipboard.'))
  } catch (err) {
    console.error('Failed to copy link:', err)
  }
}

// Utils to the utils
function getLinkStem(entity) {
  return `${
    {
      true: 'f',
      [new Boolean(entity.is_folder)]: 'd',
      [new Boolean(entity.file_type === 'Document' || entity.file_type === 'Markdown')]:
        'w',
    }[true]
  }/${entity.name}/${slugger(entity.file_name)}`
}

function slugger(file_name) {
  return slugify(file_name.split('.').join(' '), {
    lower: true,
    trim: true,
    remove: /[^\w\s']/,
  })
}

export const copyToClipboard = (str) => {
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

export function formatSize(size, nDigits = 1) {
  if (size === 0) return '0 KB'
  var i = -1
  var byteUnits = ['KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  do {
    size /= 1000
    i++
  } while (size > 1000)
  return Math.max(size, 0.1).toFixed(nDigits) + ' ' + byteUnits[i]
}

const prettyFile = (entity) => {
  entity.file_size_pretty = formatSize(entity.file_size)
  entity.relativeModified = useTimeAgo(entity.modified)
  if (entity.accessed) entity.relativeAccessed = useTimeAgo(entity.accessed)
  return entity
}

export const prettyData = (entities) => {
  if (!entities.map) return prettyFile(entities)
  return entities.map(prettyFile)
}

export const formatDate = (date) => {
  if (!date) return ''
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const locale = navigator.language || 'en-US'

  const d = dayjs(date).tz(timeZone)

  const formattedDate = d.format('MM/DD/YY')

  let formattedTime
  if (locale === 'en-US') {
    formattedTime = d.format('hh:mm A')
  } else {
    formattedTime = d.format('HH:mm')
  }

  return `${formattedDate}, ${formattedTime}`
}

export const openEntity = (entity, new_tab = false) => {
  if (new_tab) return window.open(getFileLink(entity, false), '_blank')

  if (entity.name === '') {
    router.push({ name: 'drive-Home' })
  } else if (entity.is_folder) {
    router.push({ name: 'drive-Folder', params: { entityName: entity.name } })
  } else if (entity.file_type === 'Link') {
    const origin = new URL(entity.file_url).origin
    if (confirm(`This will open an external link to ${origin} - are you sure you want to open?`)) {
      window.open(entity.file_url, '_blank')
    }
  } else if (entity.file_type === 'Presentation') {
    router.push({ name: 'slides-editor', params: { presentationId: entity.name } })
  } else if (entity.file_type === 'Document' || entity.file_type === 'Markdown') {
    router.push({ name: 'writer-document', params: { id: entity.name } })
  } else {
    router.push({ name: 'drive-File', params: { entityName: entity.name } })
  }
}
