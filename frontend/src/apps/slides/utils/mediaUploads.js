import { FileUploadHandler, toast } from 'frappe-ui'

import { session } from '@/boot/session'

import { isMediaNodeId, mediaNodeUrl } from '../stores/documentMedia'
import { addMediaElement, replaceMediaElement } from '../stores/element'
import { presentationDoc, presentationId } from '../stores/presentation'
import { currentSlide } from '../stores/slide'
import { MEDIA_PROXY_PATH, SLIDES_MEDIA_PARAM } from './slidesRequests'

export const fileUploadHandler = new FileUploadHandler()

// Core's upload_file takes only a short list of file types from users without Desk
// access, and WebP, SVG and WebM are not on it. Suite's own endpoint has no such list.
export const MEDIA_UPLOAD_ENDPOINT = '/api/method/suite.mail.api.mail.upload_file'

// these users read a file straight from /private/files; everyone else goes through the proxy
const isMediaOwner = (owner, user) => !!user && (owner === user || user === 'Administrator')

// Pass targetElement to swap that element's media instead of adding a new element.
const performPostUploadActions = async (
  fileDoc,
  fileType,
  { targetElement, targetSlide, localFile },
) => {
  if (targetElement) {
    await replaceMediaElement(targetElement, fileDoc, localFile)
    return fileDoc
  }

  await addMediaElement(fileDoc, fileType, targetSlide, localFile)
  return fileDoc
}

const uploadMedia = (file, fileType, target) => {
  return new Promise((resolve, reject) => {
    fileUploadHandler
      .upload(file, {
        doctype: 'Presentation',
        docname: presentationId.value,
        private: true,
        upload_endpoint: MEDIA_UPLOAD_ENDPOINT,
      })
      .then((fileDoc) => performPostUploadActions(fileDoc, fileType, target))
      .then(resolve)
      .catch((error) => {
        reject(error)
      })
  })
}

const isDataTransferItem = (obj) => {
  return obj && typeof obj === 'object' && 'kind' in obj && 'getAsFile' in obj
}

const isFile = (obj) => {
  return obj instanceof File
}

const getFileObject = (file) => {
  if (isDataTransferItem(file)) {
    return file.getAsFile()
  } else if (isFile(file)) {
    return file
  }
}

const handleFile = (file, toastProps, targetElement) => {
  file = getFileObject(file)
  if (!file) return

  const fileType = file.type.split('/')[0]
  if (!['image', 'video'].includes(fileType)) return

  if (targetElement && targetElement.type != fileType) targetElement = null

  const target = { targetElement, targetSlide: currentSlide.value, localFile: file }

  toast.promise(uploadMedia(file, fileType, target), toastProps)
}

const getToastProps = (file, index, length) => {
  return {
    loading: `Uploading (${index + 1}/${length})${file.name ? `: ${file.name}` : ' ...'}`,
    success: `Uploaded (${index + 1}/${length})${file.name ? `: ${file.name}` : ''}`,
    error: 'Upload failed. Please try again.',
  }
}

export const handleUploadedMedia = (files, targetElement) => {
  files = Array.from(files)

  let toastProps = {}

  if (files.length == 1) {
    toastProps = getToastProps(files[0], 0, 1)
    return handleFile(files[0], toastProps, targetElement)
  }

  files.forEach((file, index) => {
    toastProps = getToastProps(file, index, files.length)
    handleFile(file, toastProps)
  })
}

export const getAttachmentUrl = (fileUrl, sourcePresentation) => {
  if (!fileUrl) return ''

  // if starts with data: or /assets return as it is
  if (fileUrl.startsWith('data:') || fileUrl.startsWith('/assets')) return fileUrl

  // a bare node id names one of the deck's media nodes (spec §14.7, what Build
  // writes for a migrated deck); Drive signs its url through the deck session
  if (isMediaNodeId(fileUrl)) return mediaNodeUrl(fileUrl)

  // if it starts with /files add /private prefix
  if (fileUrl.startsWith('/files')) fileUrl = `/private${fileUrl}`

  if (fileUrl.startsWith('/private')) {
    const name = sourcePresentation ? sourcePresentation.name : presentationId.value
    const owner = sourcePresentation ? sourcePresentation.owner : presentationDoc.value?.owner
    const user = session.user?.sessionUser

    if (isMediaOwner(owner, user)) {
      // a duplicate borrows its source's thumbnail url, so the proxy can't serve it
      if (sourcePresentation) return fileUrl
      // Tag the request so the slides service worker can cache it without
      // touching other apps' /private/files/ traffic (Drive, Mail, ...).
      // Non-owner media already goes through the slides-namespaced proxy below.
      return `${fileUrl}${fileUrl.includes('?') ? '&' : '?'}${SLIDES_MEDIA_PARAM}=1`
    }
    if (!name) return fileUrl
    return `${MEDIA_PROXY_PATH}?src=${encodeURIComponent(fileUrl)}&presentation=${encodeURIComponent(name)}`
  }

  return fileUrl
}
