import { FileUploadHandler, toast, call } from 'frappe-ui'

import { presentationId, presentationDoc } from '../stores/presentation'
import { addMediaElement, replaceMediaElement } from '../stores/element'
import { currentSlide } from '../stores/slide'

import { session } from '@/boot/session'
import { SLIDES_MEDIA_PARAM, MEDIA_PROXY_PATH } from './slidesRequests'

const fileUploadHandler = new FileUploadHandler()

// these users read a file straight from /private/files; everyone else goes through the proxy
export const isMediaOwner = (owner, user) => !!user && (owner === user || user === 'Administrator')

// Images are converted to WebP, so the returned doc replaces the uploaded one.
// Pass targetElement to swap that element's media instead of adding a new element.
const performPostUploadActions = async (
	fileDoc,
	fileType,
	{ targetElement, targetSlide, localFile },
) => {
	if (fileType === 'image') {
		fileDoc = await getWebPDoc(fileDoc)
	}

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

const getWebPDoc = async (fileDoc) => {
	return await call('suite.slides.doctype.presentation.presentation.get_webp_doc', {
		presentation_name: presentationId.value,
		file_doc: fileDoc,
	})
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
