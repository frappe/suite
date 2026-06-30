import { useList, createResource, useCall } from 'frappe-ui'
import { prettyData } from '@/apps/writer/utils'
import { getAppSwitcherItems } from '@/apps/registry'

export const getDocuments = useList({
  url: '/api/method/suite.writer.api.general.get_document_list',
  start: 0,
  limit: 50,
  immediate: false,
  cacheKey: 'writer-document-list',
  transform: (data) => {
    return prettyData(data)
  },
})

export const createDocument = createResource({
  method: 'POST',
  url: 'suite.writer.api.docs.create_document',
  makeParams: (params) => params,
})

export const getTemplates = useList({
  doctype: 'Writer Template',
  fields: ['name', 'title', 'content', 'keymap'],
  cacheKey: 'writer-templates',
  immediate: true,
})

export const search = createResource({
  url: '/api/method/suite.writer.api.general.search',
  method: 'GET',
  makeParams: (params) => params,
})

export const updateComments = createResource({
  url: 'suite.writer.api.docs.save_comments',
  method: 'POST',
  makeParams: (params) => params,
})


export const apps = {
  get data() {
    return getAppSwitcherItems('writer')
  },
}
