// Generated from src/apps/slides/client/contract.json. Do not edit.
import type { MutationRef, PageRef, QueryRef } from '@/platform/transport'

export type GetPublicPresentationOutputReferenceAnswer = {
  reference: string
  index: number
  presentation: string | null
  node: string | null
  readable: boolean
  composite: boolean | null
  slides: Array<GetPublicPresentationOutputSlide> | null
}

export type GetPublicPresentationOutputSlide = {
  name?: string
  idx?: number
  parent?: string
  client_id?: string | null
  background?: string | null
  elements?: string | Array<{ [key: string]: unknown }> | null
  thumbnail?: string | null
  transition?: string | null
  transition_duration?: string | number | null
  fade_unmatched_elements?: boolean | (0 | 1)
  advance_after?: string | number | null
}

export type GetPublicPresentationInput = { name: string }

export type GetPublicPresentationOutput = {
  name: string
  modified: string
  modified_by: string
  node: string
  is_composite: boolean | (0 | 1)
  theme: string | null
  slides: Array<GetPublicPresentationOutputSlide>
  references?: Array<GetPublicPresentationOutputReferenceAnswer>
}

export type GetPublicPresentationError = never

const operationGetPublicPresentation: QueryRef<
  GetPublicPresentationInput,
  GetPublicPresentationOutput,
  GetPublicPresentationError
> = {
  id: 'get_public_presentation',
  owner: 'slides',
  kind: 'query',
  publicName: 'documents.get',
  envelope: 'message',
  method: 'GET',
  path: '/api/method/suite.slides.doctype.presentation.presentation.get_public_presentation',
  prefix: '/api/suite/slides/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGetPublicPresentation,
}

export type GetCompositePresentationOutputReferenceAnswer = {
  reference: string
  index: number
  presentation: string | null
  node: string | null
  readable: boolean
  composite: boolean | null
  slides: Array<GetCompositePresentationOutputSlide> | null
}

export type GetCompositePresentationOutputSlide = {
  name?: string
  idx?: number
  parent?: string
  client_id?: string | null
  background?: string | null
  elements?: string | Array<{ [key: string]: unknown }> | null
  thumbnail?: string | null
  transition?: string | null
  transition_duration?: string | number | null
  fade_unmatched_elements?: boolean | (0 | 1)
  advance_after?: string | number | null
}

export type GetCompositePresentationInput = { name: string }

export type GetCompositePresentationOutput = {
  name: string
  modified: string
  modified_by: string
  node: string
  is_composite: boolean | (0 | 1)
  theme: string | null
  slides: Array<GetCompositePresentationOutputSlide>
  references?: Array<GetCompositePresentationOutputReferenceAnswer>
}

export type GetCompositePresentationError = never

const operationGetCompositePresentation: QueryRef<
  GetCompositePresentationInput,
  GetCompositePresentationOutput,
  GetCompositePresentationError
> = {
  id: 'get_composite_presentation',
  owner: 'slides',
  kind: 'query',
  publicName: 'documents.composite',
  envelope: 'message',
  method: 'GET',
  path: '/api/method/suite.slides.doctype.presentation.presentation.get_composite_presentation',
  prefix: '/api/suite/slides/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGetCompositePresentation,
}

export type IsCompositePresentationInput = { name: string }

export type IsCompositePresentationOutput = boolean

export type IsCompositePresentationError = never

const operationIsCompositePresentation: QueryRef<
  IsCompositePresentationInput,
  IsCompositePresentationOutput,
  IsCompositePresentationError
> = {
  id: 'is_composite_presentation',
  owner: 'slides',
  kind: 'query',
  publicName: 'documents.isComposite',
  envelope: 'message',
  method: 'GET',
  path: '/api/method/suite.slides.doctype.presentation.presentation.is_composite_presentation',
  prefix: '/api/suite/slides/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationIsCompositePresentation,
}

export type SaveSlidesInputSlideChanges = {
  client_id?: string | null
  background?: string | null
  elements?: string | Array<{ [key: string]: unknown }> | null
  transition?: string | null
  transition_duration?: string | number | null
  fade_unmatched_elements?: boolean | (0 | 1)
  advance_after?: string | number | null
}

export type SaveSlidesInput = {
  name: string
  slides: Array<SaveSlidesInputSlideChanges>
  base_modified: string
}

export type SaveSlidesOutput = { modified: string }

export type SaveSlidesError = never

const operationSaveSlides: MutationRef<SaveSlidesInput, SaveSlidesOutput, SaveSlidesError> = {
  id: 'save_slides',
  owner: 'slides',
  kind: 'mutation',
  publicName: 'documents.save',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.slides.api.slides.save_slides',
  prefix: '/api/suite/slides/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationSaveSlides,
}

export type GetTemplatesOutputSlide = {
  name?: string
  idx?: number
  parent?: string
  client_id?: string | null
  background?: string | null
  elements?: string | Array<{ [key: string]: unknown }> | null
  thumbnail?: string | null
  transition?: string | null
  transition_duration?: string | number | null
  fade_unmatched_elements?: boolean | (0 | 1)
  advance_after?: string | number | null
}

export type GetTemplatesOutputTemplate = {
  name: string
  title: string
  slug: string
  creation: string
  is_template: 1
  layouts: Array<GetTemplatesOutputSlide>
}

export type GetTemplatesInput = Record<string, never>

export type GetTemplatesOutput = Array<GetTemplatesOutputTemplate>

export type GetTemplatesError = never

const operationGetTemplates: QueryRef<GetTemplatesInput, GetTemplatesOutput, GetTemplatesError> = {
  id: 'get_templates',
  owner: 'slides',
  kind: 'query',
  publicName: 'templates.list',
  envelope: 'message',
  method: 'GET',
  path: '/api/method/suite.slides.doctype.presentation.presentation.get_templates',
  prefix: '/api/suite/slides/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGetTemplates,
}

export type GetUpdatedJsonInput = {
  presentation: string
  elements: Array<{ [key: string]: unknown }>
}

export type GetUpdatedJsonOutput = Array<{ [key: string]: unknown }>

export type GetUpdatedJsonError = never

const operationGetUpdatedJson: MutationRef<
  GetUpdatedJsonInput,
  GetUpdatedJsonOutput,
  GetUpdatedJsonError
> = {
  id: 'get_updated_json',
  owner: 'slides',
  kind: 'mutation',
  publicName: 'media.adoptElements',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.slides.doctype.presentation.presentation.get_updated_json',
  prefix: '/api/suite/slides/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGetUpdatedJson,
}

export type UpdateSlideAttachmentsInput = {
  parent: string
  slide: { [key: string]: unknown } | string
}

export type UpdateSlideAttachmentsOutput = { [key: string]: unknown }

export type UpdateSlideAttachmentsError = never

const operationUpdateSlideAttachments: MutationRef<
  UpdateSlideAttachmentsInput,
  UpdateSlideAttachmentsOutput,
  UpdateSlideAttachmentsError
> = {
  id: 'update_slide_attachments',
  owner: 'slides',
  kind: 'mutation',
  publicName: 'media.adoptSlide',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.slides.doctype.presentation.presentation.update_slide_attachments',
  prefix: '/api/suite/slides/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationUpdateSlideAttachments,
}

export type CompositeManifestOutputReference = {
  reference: string
  index: number
  presentation: string | null
  node: string | null
}

export type CompositeManifestInput = { name: string }

export type CompositeManifestOutput = {
  presentation: string
  node: string
  modified: string
  group_limit: number
  reference_count: number
  references: Array<CompositeManifestOutputReference>
}

export type CompositeManifestError = never

const operationCompositeManifest: QueryRef<
  CompositeManifestInput,
  CompositeManifestOutput,
  CompositeManifestError
> = {
  id: 'composite_manifest',
  owner: 'slides',
  kind: 'query',
  publicName: 'composites.manifest',
  envelope: 'message',
  method: 'GET',
  path: '/api/method/suite.slides.api.composite.composite_manifest',
  prefix: '/api/suite/slides/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationCompositeManifest,
}

export type CompositeGroupOutputReferenceAnswer = {
  reference: string
  index: number
  presentation: string | null
  node: string | null
  readable: boolean
  composite: boolean | null
  slides: Array<CompositeGroupOutputSlide> | null
}

export type CompositeGroupOutputSlide = {
  name?: string
  idx?: number
  parent?: string
  client_id?: string | null
  background?: string | null
  elements?: string | Array<{ [key: string]: unknown }> | null
  thumbnail?: string | null
  transition?: string | null
  transition_duration?: string | number | null
  fade_unmatched_elements?: boolean | (0 | 1)
  advance_after?: string | number | null
}

export type CompositeGroupInput = { name: string; references: Array<string> | string }

export type CompositeGroupOutput = {
  presentation: string
  node: string
  references: Array<CompositeGroupOutputReferenceAnswer>
}

export type CompositeGroupError = never

const operationCompositeGroup: QueryRef<
  CompositeGroupInput,
  CompositeGroupOutput,
  CompositeGroupError
> = {
  id: 'composite_group',
  owner: 'slides',
  kind: 'query',
  publicName: 'composites.group',
  envelope: 'message',
  method: 'POST',
  path: '/api/method/suite.slides.api.composite.composite_group',
  prefix: '/api/suite/slides/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationCompositeGroup,
}

export type GetEditorAccessInput = { presentation_id: string }

export type GetEditorAccessOutput = 'edit' | 'view' | 'none'

export type GetEditorAccessError = never

const operationGetEditorAccess: QueryRef<
  GetEditorAccessInput,
  GetEditorAccessOutput,
  GetEditorAccessError
> = {
  id: 'get_editor_access',
  owner: 'slides',
  kind: 'query',
  publicName: 'documents.access',
  envelope: 'message',
  method: 'GET',
  path: '/api/method/suite.slides.doctype.presentation.presentation.get_editor_access',
  prefix: '/api/suite/slides/',
  pathParams: [],
  nodeParams: [],
  entity: null,
  errors: [],
  loadValidators: async () => (await import('./validators')).operationGetEditorAccess,
}

export const api = {
  documents: {
    get: operationGetPublicPresentation,
    composite: operationGetCompositePresentation,
    isComposite: operationIsCompositePresentation,
    save: operationSaveSlides,
    access: operationGetEditorAccess,
  },
  templates: {
    list: operationGetTemplates,
  },
  media: {
    adoptElements: operationGetUpdatedJson,
    adoptSlide: operationUpdateSlideAttachments,
  },
  composites: {
    manifest: operationCompositeManifest,
    group: operationCompositeGroup,
  },
} as const
