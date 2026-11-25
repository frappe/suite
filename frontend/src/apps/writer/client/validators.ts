// Generated from src/apps/writer/client/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  AgentGuideInput,
  AgentGuideOutput,
  ConvertVersionInput,
  ConvertVersionOutput,
  DocumentCreateInput,
  DocumentCreateOutput,
  DocumentInput,
  DocumentOutput,
  DocumentSettingsInput,
  DocumentSettingsOutput,
  DocumentWriteInput,
  DocumentWriteOutput,
  OldBodyInput,
  OldBodyOutput,
} from './generated'

export const operationDocument: Validators<DocumentInput, DocumentOutput> = {
  validateInput(value: unknown): asserts value is DocumentInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'document input',
    )
  },
  validateOutput(value: unknown): asserts value is DocumentOutput {
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
        },
        properties: {
          name: { title: 'Name', type: 'string' },
          collab: { title: 'Collab', type: 'integer' },
          content: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Content' },
          html: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Html' },
          ycomments: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Ycomments' },
          settings: {
            anyOf: [
              { type: 'string' },
              { additionalProperties: true, type: 'object' },
              { type: 'null' },
            ],
            title: 'Settings',
          },
          conversion: { $ref: '#/$defs/ConversionStatus' },
          content_modified: { title: 'Content Modified', type: 'string' },
        },
        required: ['name'],
        title: 'WriterRow',
        type: 'object',
      },
      'document output',
    )
  },
}

export const operationDocumentSettings: Validators<DocumentSettingsInput, DocumentSettingsOutput> =
  {
    validateInput(value: unknown): asserts value is DocumentSettingsInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: { data: { title: 'Data', type: 'string' }, name: { type: 'string' } },
          required: ['data', 'name'],
          additionalProperties: false,
          $defs: {},
        },
        'document_settings input',
      )
    },
    validateOutput(value: unknown): asserts value is DocumentSettingsOutput {
      assertSchema(value, { type: 'null' }, 'document_settings output')
    },
  }

export const operationDocumentCreate: Validators<DocumentCreateInput, DocumentCreateOutput> = {
  validateInput(value: unknown): asserts value is DocumentCreateInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          parent: { title: 'Parent', type: 'string' },
          title: { title: 'Title', type: 'string' },
          markdown: { title: 'Markdown', type: 'string' },
        },
        required: ['parent', 'title', 'markdown'],
        additionalProperties: false,
        $defs: {},
      },
      'document_create input',
    )
  },
  validateOutput(value: unknown): asserts value is DocumentCreateOutput {
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
        description: "The document's node as Drive answers it, and the revision the write made.",
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
        title: 'WrittenDocument',
        type: 'object',
      },
      'document_create output',
    )
  },
}

export const operationDocumentWrite: Validators<DocumentWriteInput, DocumentWriteOutput> = {
  validateInput(value: unknown): asserts value is DocumentWriteInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          markdown: { title: 'Markdown', type: 'string' },
          mode: { enum: ['replace', 'append'], title: 'Mode', type: 'string' },
          node: { type: 'string' },
        },
        required: ['markdown', 'mode', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'document_write input',
    )
  },
  validateOutput(value: unknown): asserts value is DocumentWriteOutput {
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
        description: "The document's node as Drive answers it, and the revision the write made.",
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
        title: 'WrittenDocument',
        type: 'object',
      },
      'document_write output',
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

export const operationOldBody: Validators<OldBodyInput, OldBodyOutput> = {
  validateInput(value: unknown): asserts value is OldBodyInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { title: 'Node', type: 'string' } },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'old_body input',
    )
  },
  validateOutput(value: unknown): asserts value is OldBodyOutput {
    assertSchema(
      value,
      {
        properties: { content: { title: 'Content', type: 'string' } },
        title: 'OldBody',
        type: 'object',
      },
      'old_body output',
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
