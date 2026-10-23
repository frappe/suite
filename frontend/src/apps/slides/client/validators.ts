// Generated from src/apps/slides/client/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  CompositeGroupInput,
  CompositeGroupOutput,
  CompositeManifestInput,
  CompositeManifestOutput,
  GetCompositePresentationInput,
  GetCompositePresentationOutput,
  GetEditorAccessInput,
  GetEditorAccessOutput,
  GetPublicPresentationInput,
  GetPublicPresentationOutput,
  GetTemplatesInput,
  GetTemplatesOutput,
  GetUpdatedJsonInput,
  GetUpdatedJsonOutput,
  IsCompositePresentationInput,
  IsCompositePresentationOutput,
  SaveSlidesInput,
  SaveSlidesOutput,
  UpdateSlideAttachmentsInput,
  UpdateSlideAttachmentsOutput,
} from './generated'

export const operationGetPublicPresentation: Validators<
  GetPublicPresentationInput,
  GetPublicPresentationOutput
> = {
  validateInput(value: unknown): asserts value is GetPublicPresentationInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { title: 'Name', type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'get_public_presentation input',
    )
  },
  validateOutput(value: unknown): asserts value is GetPublicPresentationOutput {
    assertSchema(
      value,
      {
        $defs: {
          ReferenceAnswer: {
            properties: {
              reference: { title: 'Reference', type: 'string' },
              index: { title: 'Index', type: 'integer' },
              presentation: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Presentation',
              },
              node: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Node' },
              readable: { title: 'Readable', type: 'boolean' },
              composite: { anyOf: [{ type: 'boolean' }, { type: 'null' }], title: 'Composite' },
              slides: {
                anyOf: [{ items: { $ref: '#/$defs/Slide' }, type: 'array' }, { type: 'null' }],
                title: 'Slides',
              },
            },
            required: [
              'reference',
              'index',
              'presentation',
              'node',
              'readable',
              'composite',
              'slides',
            ],
            title: 'ReferenceAnswer',
            type: 'object',
          },
          Slide: {
            properties: {
              name: { title: 'Name', type: 'string' },
              idx: { title: 'Idx', type: 'integer' },
              parent: { title: 'Parent', type: 'string' },
              client_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Client Id' },
              background: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Background' },
              elements: {
                anyOf: [
                  { type: 'string' },
                  { items: { additionalProperties: true, type: 'object' }, type: 'array' },
                  { type: 'null' },
                ],
                title: 'Elements',
              },
              thumbnail: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Thumbnail' },
              transition: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Transition' },
              transition_duration: {
                anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
                title: 'Transition Duration',
              },
              fade_unmatched_elements: {
                anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
                title: 'Fade Unmatched Elements',
              },
              advance_after: {
                anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
                title: 'Advance After',
              },
            },
            title: 'Slide',
            type: 'object',
          },
        },
        properties: {
          name: { title: 'Name', type: 'string' },
          modified: { title: 'Modified', type: 'string' },
          modified_by: { title: 'Modified By', type: 'string' },
          node: { title: 'Node', type: 'string' },
          is_composite: {
            anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
            title: 'Is Composite',
          },
          theme: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Theme' },
          slides: { items: { $ref: '#/$defs/Slide' }, title: 'Slides', type: 'array' },
          references: {
            items: { $ref: '#/$defs/ReferenceAnswer' },
            title: 'References',
            type: 'array',
          },
        },
        required: ['name', 'modified', 'modified_by', 'node', 'is_composite', 'theme', 'slides'],
        title: 'Deck',
        type: 'object',
      },
      'get_public_presentation output',
    )
  },
}

export const operationGetCompositePresentation: Validators<
  GetCompositePresentationInput,
  GetCompositePresentationOutput
> = {
  validateInput(value: unknown): asserts value is GetCompositePresentationInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { title: 'Name', type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'get_composite_presentation input',
    )
  },
  validateOutput(value: unknown): asserts value is GetCompositePresentationOutput {
    assertSchema(
      value,
      {
        $defs: {
          ReferenceAnswer: {
            properties: {
              reference: { title: 'Reference', type: 'string' },
              index: { title: 'Index', type: 'integer' },
              presentation: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Presentation',
              },
              node: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Node' },
              readable: { title: 'Readable', type: 'boolean' },
              composite: { anyOf: [{ type: 'boolean' }, { type: 'null' }], title: 'Composite' },
              slides: {
                anyOf: [{ items: { $ref: '#/$defs/Slide' }, type: 'array' }, { type: 'null' }],
                title: 'Slides',
              },
            },
            required: [
              'reference',
              'index',
              'presentation',
              'node',
              'readable',
              'composite',
              'slides',
            ],
            title: 'ReferenceAnswer',
            type: 'object',
          },
          Slide: {
            properties: {
              name: { title: 'Name', type: 'string' },
              idx: { title: 'Idx', type: 'integer' },
              parent: { title: 'Parent', type: 'string' },
              client_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Client Id' },
              background: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Background' },
              elements: {
                anyOf: [
                  { type: 'string' },
                  { items: { additionalProperties: true, type: 'object' }, type: 'array' },
                  { type: 'null' },
                ],
                title: 'Elements',
              },
              thumbnail: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Thumbnail' },
              transition: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Transition' },
              transition_duration: {
                anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
                title: 'Transition Duration',
              },
              fade_unmatched_elements: {
                anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
                title: 'Fade Unmatched Elements',
              },
              advance_after: {
                anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
                title: 'Advance After',
              },
            },
            title: 'Slide',
            type: 'object',
          },
        },
        properties: {
          name: { title: 'Name', type: 'string' },
          modified: { title: 'Modified', type: 'string' },
          modified_by: { title: 'Modified By', type: 'string' },
          node: { title: 'Node', type: 'string' },
          is_composite: {
            anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
            title: 'Is Composite',
          },
          theme: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Theme' },
          slides: { items: { $ref: '#/$defs/Slide' }, title: 'Slides', type: 'array' },
          references: {
            items: { $ref: '#/$defs/ReferenceAnswer' },
            title: 'References',
            type: 'array',
          },
        },
        required: ['name', 'modified', 'modified_by', 'node', 'is_composite', 'theme', 'slides'],
        title: 'Deck',
        type: 'object',
      },
      'get_composite_presentation output',
    )
  },
}

export const operationIsCompositePresentation: Validators<
  IsCompositePresentationInput,
  IsCompositePresentationOutput
> = {
  validateInput(value: unknown): asserts value is IsCompositePresentationInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { title: 'Name', type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'is_composite_presentation input',
    )
  },
  validateOutput(value: unknown): asserts value is IsCompositePresentationOutput {
    assertSchema(value, { type: 'boolean' }, 'is_composite_presentation output')
  },
}

export const operationSaveSlides: Validators<SaveSlidesInput, SaveSlidesOutput> = {
  validateInput(value: unknown): asserts value is SaveSlidesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          slides: { items: { $ref: '#/$defs/SlideChanges' }, title: 'Slides', type: 'array' },
          base_modified: { title: 'Base Modified', type: 'string' },
        },
        required: ['name', 'slides', 'base_modified'],
        additionalProperties: false,
        $defs: {
          SlideChanges: {
            properties: {
              client_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Client Id' },
              background: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Background' },
              elements: {
                anyOf: [
                  { type: 'string' },
                  { items: { additionalProperties: true, type: 'object' }, type: 'array' },
                  { type: 'null' },
                ],
                title: 'Elements',
              },
              transition: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Transition' },
              transition_duration: {
                anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
                title: 'Transition Duration',
              },
              fade_unmatched_elements: {
                anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
                title: 'Fade Unmatched Elements',
              },
              advance_after: {
                anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
                title: 'Advance After',
              },
            },
            title: 'SlideChanges',
            type: 'object',
          },
        },
      },
      'save_slides input',
    )
  },
  validateOutput(value: unknown): asserts value is SaveSlidesOutput {
    assertSchema(
      value,
      {
        properties: { modified: { title: 'Modified', type: 'string' } },
        required: ['modified'],
        title: 'SavedDeck',
        type: 'object',
      },
      'save_slides output',
    )
  },
}

export const operationGetTemplates: Validators<GetTemplatesInput, GetTemplatesOutput> = {
  validateInput(value: unknown): asserts value is GetTemplatesInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_templates input',
    )
  },
  validateOutput(value: unknown): asserts value is GetTemplatesOutput {
    assertSchema(
      value,
      {
        $defs: {
          Slide: {
            properties: {
              name: { title: 'Name', type: 'string' },
              idx: { title: 'Idx', type: 'integer' },
              parent: { title: 'Parent', type: 'string' },
              client_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Client Id' },
              background: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Background' },
              elements: {
                anyOf: [
                  { type: 'string' },
                  { items: { additionalProperties: true, type: 'object' }, type: 'array' },
                  { type: 'null' },
                ],
                title: 'Elements',
              },
              thumbnail: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Thumbnail' },
              transition: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Transition' },
              transition_duration: {
                anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
                title: 'Transition Duration',
              },
              fade_unmatched_elements: {
                anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
                title: 'Fade Unmatched Elements',
              },
              advance_after: {
                anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
                title: 'Advance After',
              },
            },
            title: 'Slide',
            type: 'object',
          },
          Template: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              slug: { title: 'Slug', type: 'string' },
              creation: { title: 'Creation', type: 'string' },
              is_template: { const: 1, title: 'Is Template', type: 'integer' },
              layouts: { items: { $ref: '#/$defs/Slide' }, title: 'Layouts', type: 'array' },
            },
            required: ['name', 'title', 'slug', 'creation', 'is_template', 'layouts'],
            title: 'Template',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/Template' },
        type: 'array',
      },
      'get_templates output',
    )
  },
}

export const operationGetUpdatedJson: Validators<GetUpdatedJsonInput, GetUpdatedJsonOutput> = {
  validateInput(value: unknown): asserts value is GetUpdatedJsonInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          presentation: { title: 'Presentation', type: 'string' },
          elements: {
            items: { additionalProperties: true, type: 'object' },
            title: 'Elements',
            type: 'array',
          },
        },
        required: ['presentation', 'elements'],
        additionalProperties: false,
        $defs: {},
      },
      'get_updated_json input',
    )
  },
  validateOutput(value: unknown): asserts value is GetUpdatedJsonOutput {
    assertSchema(
      value,
      { items: { additionalProperties: true, type: 'object' }, type: 'array' },
      'get_updated_json output',
    )
  },
}

export const operationUpdateSlideAttachments: Validators<
  UpdateSlideAttachmentsInput,
  UpdateSlideAttachmentsOutput
> = {
  validateInput(value: unknown): asserts value is UpdateSlideAttachmentsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          parent: { title: 'Parent', type: 'string' },
          slide: {
            anyOf: [{ additionalProperties: true, type: 'object' }, { type: 'string' }],
            title: 'Slide',
          },
        },
        required: ['parent', 'slide'],
        additionalProperties: false,
        $defs: {},
      },
      'update_slide_attachments input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateSlideAttachmentsOutput {
    assertSchema(
      value,
      { additionalProperties: true, type: 'object' },
      'update_slide_attachments output',
    )
  },
}

export const operationCompositeManifest: Validators<
  CompositeManifestInput,
  CompositeManifestOutput
> = {
  validateInput(value: unknown): asserts value is CompositeManifestInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { title: 'Name', type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'composite_manifest input',
    )
  },
  validateOutput(value: unknown): asserts value is CompositeManifestOutput {
    assertSchema(
      value,
      {
        $defs: {
          Reference: {
            properties: {
              reference: { title: 'Reference', type: 'string' },
              index: { title: 'Index', type: 'integer' },
              presentation: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Presentation',
              },
              node: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Node' },
            },
            required: ['reference', 'index', 'presentation', 'node'],
            title: 'Reference',
            type: 'object',
          },
        },
        properties: {
          presentation: { title: 'Presentation', type: 'string' },
          node: { title: 'Node', type: 'string' },
          modified: { title: 'Modified', type: 'string' },
          group_limit: { title: 'Group Limit', type: 'integer' },
          reference_count: { title: 'Reference Count', type: 'integer' },
          references: { items: { $ref: '#/$defs/Reference' }, title: 'References', type: 'array' },
        },
        required: [
          'presentation',
          'node',
          'modified',
          'group_limit',
          'reference_count',
          'references',
        ],
        title: 'Manifest',
        type: 'object',
      },
      'composite_manifest output',
    )
  },
}

export const operationCompositeGroup: Validators<CompositeGroupInput, CompositeGroupOutput> = {
  validateInput(value: unknown): asserts value is CompositeGroupInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          references: {
            anyOf: [{ items: { type: 'string' }, type: 'array' }, { type: 'string' }],
            title: 'References',
          },
        },
        required: ['name', 'references'],
        additionalProperties: false,
        $defs: {},
      },
      'composite_group input',
    )
  },
  validateOutput(value: unknown): asserts value is CompositeGroupOutput {
    assertSchema(
      value,
      {
        $defs: {
          ReferenceAnswer: {
            properties: {
              reference: { title: 'Reference', type: 'string' },
              index: { title: 'Index', type: 'integer' },
              presentation: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Presentation',
              },
              node: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Node' },
              readable: { title: 'Readable', type: 'boolean' },
              composite: { anyOf: [{ type: 'boolean' }, { type: 'null' }], title: 'Composite' },
              slides: {
                anyOf: [{ items: { $ref: '#/$defs/Slide' }, type: 'array' }, { type: 'null' }],
                title: 'Slides',
              },
            },
            required: [
              'reference',
              'index',
              'presentation',
              'node',
              'readable',
              'composite',
              'slides',
            ],
            title: 'ReferenceAnswer',
            type: 'object',
          },
          Slide: {
            properties: {
              name: { title: 'Name', type: 'string' },
              idx: { title: 'Idx', type: 'integer' },
              parent: { title: 'Parent', type: 'string' },
              client_id: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Client Id' },
              background: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Background' },
              elements: {
                anyOf: [
                  { type: 'string' },
                  { items: { additionalProperties: true, type: 'object' }, type: 'array' },
                  { type: 'null' },
                ],
                title: 'Elements',
              },
              thumbnail: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Thumbnail' },
              transition: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Transition' },
              transition_duration: {
                anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
                title: 'Transition Duration',
              },
              fade_unmatched_elements: {
                anyOf: [{ type: 'boolean' }, { enum: [0, 1], type: 'integer' }],
                title: 'Fade Unmatched Elements',
              },
              advance_after: {
                anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
                title: 'Advance After',
              },
            },
            title: 'Slide',
            type: 'object',
          },
        },
        properties: {
          presentation: { title: 'Presentation', type: 'string' },
          node: { title: 'Node', type: 'string' },
          references: {
            items: { $ref: '#/$defs/ReferenceAnswer' },
            title: 'References',
            type: 'array',
          },
        },
        required: ['presentation', 'node', 'references'],
        title: 'GroupResult',
        type: 'object',
      },
      'composite_group output',
    )
  },
}

export const operationGetEditorAccess: Validators<GetEditorAccessInput, GetEditorAccessOutput> = {
  validateInput(value: unknown): asserts value is GetEditorAccessInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { presentation_id: { title: 'Presentation Id', type: 'string' } },
        required: ['presentation_id'],
        additionalProperties: false,
        $defs: {},
      },
      'get_editor_access input',
    )
  },
  validateOutput(value: unknown): asserts value is GetEditorAccessOutput {
    assertSchema(
      value,
      { enum: ['edit', 'view', 'none'], type: 'string' },
      'get_editor_access output',
    )
  },
}
