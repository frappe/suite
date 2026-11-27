// Generated from src/apps/sheets/client/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  AiAssistInput,
  AiAssistOutput,
  GetAiSettingsInput,
  GetAiSettingsOutput,
  GetConversionInput,
  GetConversionOutput,
  GetLinkPreviewInput,
  GetLinkPreviewOutput,
  GetSheetInput,
  GetSheetOutput,
  SaveAiSettingsInput,
  SaveAiSettingsOutput,
  SpreadsheetCellsWriteInput,
  SpreadsheetCellsWriteOutput,
  SpreadsheetCreateInput,
  SpreadsheetCreateOutput,
  SpreadsheetReadInput,
  SpreadsheetReadOutput,
  SpreadsheetRowsAppendInput,
  SpreadsheetRowsAppendOutput,
  SpreadsheetSheetAddInput,
  SpreadsheetSheetAddOutput,
} from './generated'

export const operationSpreadsheetCreate: Validators<
  SpreadsheetCreateInput,
  SpreadsheetCreateOutput
> = {
  validateInput(value: unknown): asserts value is SpreadsheetCreateInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          parent: { title: 'Parent', type: 'string' },
          title: { title: 'Title', type: 'string' },
          sheets: { items: { $ref: '#/$defs/SheetCells' }, title: 'Sheets', type: 'array' },
        },
        required: ['parent', 'title', 'sheets'],
        additionalProperties: false,
        $defs: {
          SheetCells: {
            properties: {
              name: { title: 'Name', type: 'string' },
              rows: {
                items: {
                  items: {
                    anyOf: [
                      { type: 'string' },
                      { type: 'integer' },
                      { type: 'number' },
                      { type: 'boolean' },
                      { type: 'null' },
                    ],
                  },
                  type: 'array',
                },
                title: 'Rows',
                type: 'array',
              },
            },
            required: ['name'],
            title: 'SheetCells',
            type: 'object',
          },
        },
      },
      'spreadsheet_create input',
    )
  },
  validateOutput(value: unknown): asserts value is SpreadsheetCreateOutput {
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
        description: "The spreadsheet's node as Drive answers it, and the revision the write made.",
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
        title: 'WrittenSpreadsheet',
        type: 'object',
      },
      'spreadsheet_create output',
    )
  },
}

export const operationSpreadsheetCellsWrite: Validators<
  SpreadsheetCellsWriteInput,
  SpreadsheetCellsWriteOutput
> = {
  validateInput(value: unknown): asserts value is SpreadsheetCellsWriteInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          sheet: { title: 'Sheet', type: 'string' },
          start: { title: 'Start', type: 'string' },
          rows: {
            items: {
              items: {
                anyOf: [
                  { type: 'string' },
                  { type: 'integer' },
                  { type: 'number' },
                  { type: 'boolean' },
                  { type: 'null' },
                ],
              },
              type: 'array',
            },
            title: 'Rows',
            type: 'array',
          },
          node: { type: 'string' },
        },
        required: ['sheet', 'start', 'rows', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'spreadsheet_cells_write input',
    )
  },
  validateOutput(value: unknown): asserts value is SpreadsheetCellsWriteOutput {
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
        description: "The spreadsheet's node as Drive answers it, and the revision the write made.",
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
        title: 'WrittenSpreadsheet',
        type: 'object',
      },
      'spreadsheet_cells_write output',
    )
  },
}

export const operationSpreadsheetRowsAppend: Validators<
  SpreadsheetRowsAppendInput,
  SpreadsheetRowsAppendOutput
> = {
  validateInput(value: unknown): asserts value is SpreadsheetRowsAppendInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          sheet: { title: 'Sheet', type: 'string' },
          rows: {
            items: {
              items: {
                anyOf: [
                  { type: 'string' },
                  { type: 'integer' },
                  { type: 'number' },
                  { type: 'boolean' },
                  { type: 'null' },
                ],
              },
              type: 'array',
            },
            title: 'Rows',
            type: 'array',
          },
          node: { type: 'string' },
        },
        required: ['sheet', 'rows', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'spreadsheet_rows_append input',
    )
  },
  validateOutput(value: unknown): asserts value is SpreadsheetRowsAppendOutput {
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
        description: "The spreadsheet's node as Drive answers it, and the revision the write made.",
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
        title: 'WrittenSpreadsheet',
        type: 'object',
      },
      'spreadsheet_rows_append output',
    )
  },
}

export const operationSpreadsheetSheetAdd: Validators<
  SpreadsheetSheetAddInput,
  SpreadsheetSheetAddOutput
> = {
  validateInput(value: unknown): asserts value is SpreadsheetSheetAddInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          rows: {
            items: {
              items: {
                anyOf: [
                  { type: 'string' },
                  { type: 'integer' },
                  { type: 'number' },
                  { type: 'boolean' },
                  { type: 'null' },
                ],
              },
              type: 'array',
            },
            title: 'Rows',
            type: 'array',
          },
          node: { type: 'string' },
        },
        required: ['name', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'spreadsheet_sheet_add input',
    )
  },
  validateOutput(value: unknown): asserts value is SpreadsheetSheetAddOutput {
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
        description: "The spreadsheet's node as Drive answers it, and the revision the write made.",
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
        title: 'WrittenSpreadsheet',
        type: 'object',
      },
      'spreadsheet_sheet_add output',
    )
  },
}

export const operationSpreadsheetRead: Validators<SpreadsheetReadInput, SpreadsheetReadOutput> = {
  validateInput(value: unknown): asserts value is SpreadsheetReadInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' } },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'spreadsheet_read input',
    )
  },
  validateOutput(value: unknown): asserts value is SpreadsheetReadOutput {
    assertSchema(
      value,
      {
        $defs: {
          TypedSheet: {
            properties: {
              name: { title: 'Name', type: 'string' },
              rows: {
                items: { items: { type: 'string' }, type: 'array' },
                title: 'Rows',
                type: 'array',
              },
            },
            required: ['name', 'rows'],
            title: 'TypedSheet',
            type: 'object',
          },
        },
        properties: {
          sheets: { items: { $ref: '#/$defs/TypedSheet' }, title: 'Sheets', type: 'array' },
        },
        required: ['sheets'],
        title: 'SpreadsheetCells',
        type: 'object',
      },
      'spreadsheet_read output',
    )
  },
}

export const operationGetSheet: Validators<GetSheetInput, GetSheetOutput> = {
  validateInput(value: unknown): asserts value is GetSheetInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          compressed: { enum: [0, 1], title: 'Compressed', type: 'integer' },
        },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'get_sheet input',
    )
  },
  validateOutput(value: unknown): asserts value is GetSheetOutput {
    assertSchema(
      value,
      {
        properties: {
          name: { title: 'Name', type: 'string' },
          title: { title: 'Title', type: 'string' },
          can_write: { title: 'Can Write', type: 'boolean' },
          sheets_data: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Sheets Data' },
          owner: { title: 'Owner', type: 'string' },
          node: { title: 'Node', type: 'string' },
        },
        required: ['name', 'title', 'can_write', 'sheets_data', 'owner', 'node'],
        title: 'SheetBody',
        type: 'object',
      },
      'get_sheet output',
    )
  },
}

export const operationGetConversion: Validators<GetConversionInput, GetConversionOutput> = {
  validateInput(value: unknown): asserts value is GetConversionInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { name: { title: 'Name', type: 'string' } },
        required: ['name'],
        additionalProperties: false,
        $defs: {},
      },
      'get_conversion input',
    )
  },
  validateOutput(value: unknown): asserts value is GetConversionOutput {
    assertSchema(
      value,
      {
        properties: {
          state: { enum: ['converted', 'pending', 'refused'], title: 'State', type: 'string' },
          outcome: { title: 'Outcome', type: 'string' },
          reason: { title: 'Reason', type: 'string' },
        },
        required: ['state'],
        title: 'SheetConversion',
        type: 'object',
      },
      'get_conversion output',
    )
  },
}

export const operationGetAiSettings: Validators<GetAiSettingsInput, GetAiSettingsOutput> = {
  validateInput(value: unknown): asserts value is GetAiSettingsInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'get_ai_settings input',
    )
  },
  validateOutput(value: unknown): asserts value is GetAiSettingsOutput {
    assertSchema(
      value,
      {
        properties: {
          enabled: { title: 'Enabled', type: 'boolean' },
          model: { title: 'Model', type: 'string' },
          keyIsSet: { title: 'Keyisset', type: 'boolean' },
        },
        required: ['enabled', 'model', 'keyIsSet'],
        title: 'AISettings',
        type: 'object',
      },
      'get_ai_settings output',
    )
  },
}

export const operationSaveAiSettings: Validators<SaveAiSettingsInput, SaveAiSettingsOutput> = {
  validateInput(value: unknown): asserts value is SaveAiSettingsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          api_key: { title: 'Api Key', type: 'string' },
          enabled: { enum: [0, 1], title: 'Enabled', type: 'integer' },
          model: { title: 'Model', type: 'string' },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'save_ai_settings input',
    )
  },
  validateOutput(value: unknown): asserts value is SaveAiSettingsOutput {
    assertSchema(
      value,
      {
        properties: {
          enabled: { title: 'Enabled', type: 'boolean' },
          model: { title: 'Model', type: 'string' },
          keyIsSet: { title: 'Keyisset', type: 'boolean' },
        },
        required: ['enabled', 'model', 'keyIsSet'],
        title: 'AISettings',
        type: 'object',
      },
      'save_ai_settings output',
    )
  },
}

export const operationAiAssist: Validators<AiAssistInput, AiAssistOutput> = {
  validateInput(value: unknown): asserts value is AiAssistInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          name: { title: 'Name', type: 'string' },
          prompt: { title: 'Prompt', type: 'string' },
          selection: { title: 'Selection', type: 'string' },
          cells: { title: 'Cells', type: 'string' },
        },
        required: ['name', 'prompt', 'selection'],
        additionalProperties: false,
        $defs: {},
      },
      'ai_assist input',
    )
  },
  validateOutput(value: unknown): asserts value is AiAssistOutput {
    assertSchema(
      value,
      {
        properties: {
          actions: {
            items: { additionalProperties: true, type: 'object' },
            title: 'Actions',
            type: 'array',
          },
          model: { title: 'Model', type: 'string' },
          source: { title: 'Source', type: 'string' },
        },
        required: ['actions', 'model', 'source'],
        title: 'AssistResult',
        type: 'object',
      },
      'ai_assist output',
    )
  },
}

export const operationGetLinkPreview: Validators<GetLinkPreviewInput, GetLinkPreviewOutput> = {
  validateInput(value: unknown): asserts value is GetLinkPreviewInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { url: { title: 'Url', type: 'string' } },
        required: ['url'],
        additionalProperties: false,
        $defs: {},
      },
      'get_link_preview input',
    )
  },
  validateOutput(value: unknown): asserts value is GetLinkPreviewOutput {
    assertSchema(
      value,
      {
        $defs: {
          LinkFailure: {
            properties: { error: { const: true, title: 'Error', type: 'boolean' } },
            required: ['error'],
            title: 'LinkFailure',
            type: 'object',
          },
          LinkPreview: {
            properties: {
              title: { title: 'Title', type: 'string' },
              description: { title: 'Description', type: 'string' },
              favicon: { title: 'Favicon', type: 'string' },
              host: { title: 'Host', type: 'string' },
            },
            required: ['title', 'description', 'favicon', 'host'],
            title: 'LinkPreview',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/LinkPreview' }, { $ref: '#/$defs/LinkFailure' }],
      },
      'get_link_preview output',
    )
  },
}
