// Generated from src/apps/slides/client/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  AgentGuideInput,
  AgentGuideOutput,
  ApplyThemeInput,
  ApplyThemeOutput,
  CompositeGroupInput,
  CompositeGroupOutput,
  CompositeManifestInput,
  CompositeManifestOutput,
  ConvertVersionInput,
  ConvertVersionOutput,
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
  PresentationCreateInput,
  PresentationCreateOutput,
  PresentationReadInput,
  PresentationReadOutput,
  PresentationWriteInput,
  PresentationWriteOutput,
  RecoveryNamesInput,
  RecoveryNamesOutput,
  UpdateSlideAttachmentsInput,
  UpdateSlideAttachmentsOutput,
  UpdateThemeInput,
  UpdateThemeOutput,
} from './generated'

export const operationPresentationCreate: Validators<
  PresentationCreateInput,
  PresentationCreateOutput
> = {
  validateInput(value: unknown): asserts value is PresentationCreateInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          parent: { title: 'Parent', type: 'string' },
          title: { title: 'Title', type: 'string' },
          slides: {
            items: { additionalProperties: true, type: 'object' },
            title: 'Slides',
            type: 'array',
          },
        },
        required: ['parent', 'title', 'slides'],
        additionalProperties: false,
        $defs: {},
      },
      'presentation_create input',
    )
  },
  validateOutput(value: unknown): asserts value is PresentationCreateOutput {
    assertSchema(
      value,
      {
        $defs: {
          AccessShape: {
            properties: {
              role: { title: 'Role', type: 'integer' },
              via_link: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Via Link' },
              source_node: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Source Node' },
              source_principal: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Source Principal',
              },
              can_manage: { title: 'Can Manage', type: 'boolean' },
            },
            title: 'AccessShape',
            type: 'object',
          },
          AudienceShape: {
            description: 'How widely a node is shared. It names nobody, so any reader may see it.',
            properties: {
              kind: {
                enum: ['public', 'organization', 'link', 'people'],
                title: 'Kind',
                type: 'string',
              },
              people: { title: 'People', type: 'integer' },
            },
            required: ['kind', 'people'],
            title: 'AudienceShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
              role: { title: 'Role', type: 'integer' },
            },
            required: ['name', 'title', 'kind', 'role'],
            title: 'BreadcrumbShape',
            type: 'object',
          },
          Person: {
            properties: {
              id: { title: 'Id', type: 'string' },
              full_name: { title: 'Full Name', type: 'string' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: ['id', 'full_name', 'user_image'],
            title: 'Person',
            type: 'object',
          },
          PreviewShape: {
            properties: {
              url: { title: 'Url', type: 'string' },
              expires: { title: 'Expires', type: 'integer' },
            },
            required: ['url', 'expires'],
            title: 'PreviewShape',
            type: 'object',
          },
        },
        description:
          "The presentation's node as Drive answers it, and the revision the write made.",
        properties: {
          name: { title: 'Name', type: 'string' },
          title: { title: 'Title', type: 'string' },
          kind: { title: 'Kind', type: 'string' },
          parent_node: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Parent Node' },
          root: { title: 'Root', type: 'string' },
          state: { title: 'State', type: 'string' },
          trash_root: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Trash Root' },
          size: { title: 'Size', type: 'integer' },
          mime: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Mime' },
          url: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Url' },
          content_doctype: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Content Doctype',
          },
          content_docname: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Content Docname',
          },
          is_template: { title: 'Is Template', type: 'integer' },
          owner: { $ref: '#/$defs/Person' },
          creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
          modified: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Modified' },
          content_modified: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Content Modified',
          },
          access: { $ref: '#/$defs/AccessShape' },
          audience: { $ref: '#/$defs/AudienceShape' },
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          contents_size: { title: 'Contents Size', type: 'integer' },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
          rev: { title: 'Rev', type: 'integer' },
        },
        required: [
          'name',
          'title',
          'kind',
          'parent_node',
          'root',
          'state',
          'trash_root',
          'size',
          'mime',
          'url',
          'content_doctype',
          'content_docname',
          'is_template',
          'owner',
          'creation',
          'modified',
          'content_modified',
          'rev',
        ],
        title: 'WrittenPresentation',
        type: 'object',
      },
      'presentation_create output',
    )
  },
}

export const operationPresentationWrite: Validators<
  PresentationWriteInput,
  PresentationWriteOutput
> = {
  validateInput(value: unknown): asserts value is PresentationWriteInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          slides: {
            items: { additionalProperties: true, type: 'object' },
            title: 'Slides',
            type: 'array',
          },
          mode: { const: 'replace', title: 'Mode', type: 'string' },
          node: { type: 'string' },
        },
        required: ['slides', 'mode', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'presentation_write input',
    )
  },
  validateOutput(value: unknown): asserts value is PresentationWriteOutput {
    assertSchema(
      value,
      {
        $defs: {
          AccessShape: {
            properties: {
              role: { title: 'Role', type: 'integer' },
              via_link: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Via Link' },
              source_node: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Source Node' },
              source_principal: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
                title: 'Source Principal',
              },
              can_manage: { title: 'Can Manage', type: 'boolean' },
            },
            title: 'AccessShape',
            type: 'object',
          },
          AudienceShape: {
            description: 'How widely a node is shared. It names nobody, so any reader may see it.',
            properties: {
              kind: {
                enum: ['public', 'organization', 'link', 'people'],
                title: 'Kind',
                type: 'string',
              },
              people: { title: 'People', type: 'integer' },
            },
            required: ['kind', 'people'],
            title: 'AudienceShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
              role: { title: 'Role', type: 'integer' },
            },
            required: ['name', 'title', 'kind', 'role'],
            title: 'BreadcrumbShape',
            type: 'object',
          },
          Person: {
            properties: {
              id: { title: 'Id', type: 'string' },
              full_name: { title: 'Full Name', type: 'string' },
              user_image: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User Image' },
            },
            required: ['id', 'full_name', 'user_image'],
            title: 'Person',
            type: 'object',
          },
          PreviewShape: {
            properties: {
              url: { title: 'Url', type: 'string' },
              expires: { title: 'Expires', type: 'integer' },
            },
            required: ['url', 'expires'],
            title: 'PreviewShape',
            type: 'object',
          },
        },
        description:
          "The presentation's node as Drive answers it, and the revision the write made.",
        properties: {
          name: { title: 'Name', type: 'string' },
          title: { title: 'Title', type: 'string' },
          kind: { title: 'Kind', type: 'string' },
          parent_node: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Parent Node' },
          root: { title: 'Root', type: 'string' },
          state: { title: 'State', type: 'string' },
          trash_root: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Trash Root' },
          size: { title: 'Size', type: 'integer' },
          mime: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Mime' },
          url: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Url' },
          content_doctype: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Content Doctype',
          },
          content_docname: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Content Docname',
          },
          is_template: { title: 'Is Template', type: 'integer' },
          owner: { $ref: '#/$defs/Person' },
          creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
          modified: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Modified' },
          content_modified: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            title: 'Content Modified',
          },
          access: { $ref: '#/$defs/AccessShape' },
          audience: { $ref: '#/$defs/AudienceShape' },
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          contents_size: { title: 'Contents Size', type: 'integer' },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
          rev: { title: 'Rev', type: 'integer' },
        },
        required: [
          'name',
          'title',
          'kind',
          'parent_node',
          'root',
          'state',
          'trash_root',
          'size',
          'mime',
          'url',
          'content_doctype',
          'content_docname',
          'is_template',
          'owner',
          'creation',
          'modified',
          'content_modified',
          'rev',
        ],
        title: 'WrittenPresentation',
        type: 'object',
      },
      'presentation_write output',
    )
  },
}

export const operationPresentationRead: Validators<PresentationReadInput, PresentationReadOutput> =
  {
    validateInput(value: unknown): asserts value is PresentationReadInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: { node: { type: 'string' } },
          required: ['node'],
          additionalProperties: false,
          $defs: {},
        },
        'presentation_read input',
      )
    },
    validateOutput(value: unknown): asserts value is PresentationReadOutput {
      assertSchema(
        value,
        {
          properties: {
            slides: {
              items: { additionalProperties: true, type: 'object' },
              title: 'Slides',
              type: 'array',
            },
          },
          required: ['slides'],
          title: 'PresentationSlides',
          type: 'object',
        },
        'presentation_read output',
      )
    },
  }

export const operationAgentGuide: Validators<AgentGuideInput, AgentGuideOutput> = {
  validateInput(value: unknown): asserts value is AgentGuideInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'agent_guide input',
    )
  },
  validateOutput(value: unknown): asserts value is AgentGuideOutput {
    if (!(value instanceof Blob)) throw new TypeError('Expected Blob')
  },
}

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
          ConversionStatus: {
            properties: {
              state: { title: 'State', type: 'string' },
              reason: { title: 'Reason', type: 'string' },
              rooms: { $ref: '#/$defs/Rooms' },
            },
            required: ['state'],
            title: 'ConversionStatus',
            type: 'object',
          },
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
          Rooms: {
            properties: {
              epoch: { title: 'Epoch', type: 'integer' },
              keys: { items: { type: 'string' }, title: 'Keys', type: 'array' },
              epoch_seconds: { title: 'Epoch Seconds', type: 'integer' },
              server_time: { title: 'Server Time', type: 'number' },
            },
            required: ['epoch', 'keys', 'epoch_seconds', 'server_time'],
            title: 'Rooms',
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
          is_converted: { title: 'Is Converted', type: 'boolean' },
          conversion: { $ref: '#/$defs/ConversionStatus' },
        },
        required: ['name', 'modified', 'modified_by', 'node', 'is_composite', 'theme'],
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
          ConversionStatus: {
            properties: {
              state: { title: 'State', type: 'string' },
              reason: { title: 'Reason', type: 'string' },
              rooms: { $ref: '#/$defs/Rooms' },
            },
            required: ['state'],
            title: 'ConversionStatus',
            type: 'object',
          },
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
          Rooms: {
            properties: {
              epoch: { title: 'Epoch', type: 'integer' },
              keys: { items: { type: 'string' }, title: 'Keys', type: 'array' },
              epoch_seconds: { title: 'Epoch Seconds', type: 'integer' },
              server_time: { title: 'Server Time', type: 'number' },
            },
            required: ['epoch', 'keys', 'epoch_seconds', 'server_time'],
            title: 'Rooms',
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
          is_converted: { title: 'Is Converted', type: 'boolean' },
          conversion: { $ref: '#/$defs/ConversionStatus' },
        },
        required: ['name', 'modified', 'modified_by', 'node', 'is_composite', 'theme'],
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

export const operationApplyTheme: Validators<ApplyThemeInput, ApplyThemeOutput> = {
  validateInput(value: unknown): asserts value is ApplyThemeInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          theme: { title: 'Theme', type: 'string' },
        },
        required: ['name', 'theme'],
        additionalProperties: false,
        $defs: {},
      },
      'apply_theme input',
    )
  },
  validateOutput(value: unknown): asserts value is ApplyThemeOutput {
    assertSchema(
      value,
      {
        properties: { modified: { title: 'Modified', type: 'string' } },
        required: ['modified'],
        title: 'SavedDeck',
        type: 'object',
      },
      'apply_theme output',
    )
  },
}

export const operationUpdateTheme: Validators<UpdateThemeInput, UpdateThemeOutput> = {
  validateInput(value: unknown): asserts value is UpdateThemeInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          theme: { title: 'Theme', type: 'string' },
        },
        required: ['name', 'theme'],
        additionalProperties: false,
        $defs: {},
      },
      'update_theme input',
    )
  },
  validateOutput(value: unknown): asserts value is UpdateThemeOutput {
    assertSchema(
      value,
      {
        properties: {
          modified: { title: 'Modified', type: 'string' },
          base_modified: { title: 'Base Modified', type: 'string' },
        },
        required: ['modified', 'base_modified'],
        title: 'ThemedDeck',
        type: 'object',
      },
      'update_theme output',
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
              node: { title: 'Node', type: 'string' },
              title: { title: 'Title', type: 'string' },
              slug: { title: 'Slug', type: 'string' },
              creation: { title: 'Creation', type: 'string' },
              is_template: { const: 1, title: 'Is Template', type: 'integer' },
              is_converted: { title: 'Is Converted', type: 'boolean' },
              thumbnails: { items: { type: 'string' }, title: 'Thumbnails', type: 'array' },
              layouts: { items: { $ref: '#/$defs/Slide' }, title: 'Layouts', type: 'array' },
            },
            required: [
              'name',
              'node',
              'title',
              'slug',
              'creation',
              'is_template',
              'is_converted',
              'thumbnails',
              'layouts',
            ],
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

export const operationConvertVersion: Validators<ConvertVersionInput, ConvertVersionOutput> = {
  validateInput(value: unknown): asserts value is ConvertVersionInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          node: { title: 'Node', type: 'string' },
          seq: { title: 'Seq', type: 'integer' },
        },
        required: ['node', 'seq'],
        additionalProperties: false,
        $defs: {},
      },
      'convert_version input',
    )
  },
  validateOutput(value: unknown): asserts value is ConvertVersionOutput {
    assertSchema(
      value,
      {
        properties: {
          state: { title: 'State', type: 'string' },
          reason: { title: 'Reason', type: 'string' },
          pending: { title: 'Pending', type: 'boolean' },
        },
        title: 'VersionConversion',
        type: 'object',
      },
      'convert_version output',
    )
  },
}

export const operationRecoveryNames: Validators<RecoveryNamesInput, RecoveryNamesOutput> = {
  validateInput(value: unknown): asserts value is RecoveryNamesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          presentations: { items: { type: 'string' }, title: 'Presentations', type: 'array' },
          nodes: { items: { type: 'string' }, title: 'Nodes', type: 'array' },
        },
        required: ['presentations', 'nodes'],
        additionalProperties: false,
        $defs: {},
      },
      'recovery_names input',
    )
  },
  validateOutput(value: unknown): asserts value is RecoveryNamesOutput {
    assertSchema(
      value,
      {
        $defs: {
          RecoveryName: {
            properties: {
              presentation: { title: 'Presentation', type: 'string' },
              node: { title: 'Node', type: 'string' },
              title: { title: 'Title', type: 'string' },
              can_edit: { title: 'Can Edit', type: 'boolean' },
            },
            required: ['presentation', 'node', 'title', 'can_edit'],
            title: 'RecoveryName',
            type: 'object',
          },
        },
        items: { $ref: '#/$defs/RecoveryName' },
        type: 'array',
      },
      'recovery_names output',
    )
  },
}
