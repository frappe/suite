// Generated from src/apps/drive/client/contract.json. Do not edit.
import type { Validators } from '@/platform/transport'
import { assertSchema } from '@/platform/transport/schema'

import type {
  CommentDeleteInput,
  CommentDeleteOutput,
  CommentPatchInput,
  CommentPatchOutput,
  GrantDeleteInput,
  GrantDeleteOutput,
  GrantPatchInput,
  GrantPatchOutput,
  GrantRotateInput,
  GrantRotateOutput,
  LinkUnlockInput,
  LinkUnlockOutput,
  NodeActivityInput,
  NodeActivityOutput,
  NodeArchiveDownloadInput,
  NodeArchiveDownloadOutput,
  NodeArchiveStartInput,
  NodeArchiveStartOutput,
  NodeArchiveStatusInput,
  NodeArchiveStatusOutput,
  NodeBatchInput,
  NodeBatchOutput,
  NodeBatchPurgeInput,
  NodeBatchPurgeOutput,
  NodeChildrenInput,
  NodeChildrenOutput,
  NodeCopyInput,
  NodeCopyOutput,
  NodeCreateCreateDocumentInput,
  NodeCreateCreateDocumentOutput,
  NodeCreateCreateFileInput,
  NodeCreateCreateFileOutput,
  NodeCreateCreateFolderInput,
  NodeCreateCreateFolderOutput,
  NodeCreateCreateLinkInput,
  NodeCreateCreateLinkOutput,
  NodeDeleteFavouriteInput,
  NodeDeleteFavouriteOutput,
  NodeDeleteGrantInput,
  NodeDeleteGrantOutput,
  NodeGetContentInput,
  NodeGetContentOutput,
  NodeGetInput,
  NodeGetOutput,
  NodeGrantsInput,
  NodeGrantsOutput,
  NodeMediaInput,
  NodeMediaOutput,
  NodePatchMoveInput,
  NodePatchMoveOutput,
  NodePatchRenameInput,
  NodePatchRenameOutput,
  NodePatchRestoreInput,
  NodePatchRestoreOutput,
  NodePatchStampInput,
  NodePatchStampOutput,
  NodePatchTrashInput,
  NodePatchTrashOutput,
  NodePreviewInput,
  NodePreviewOutput,
  NodePurgeInput,
  NodePurgeOutput,
  NodePutContentInput,
  NodePutContentOutput,
  NodePutFavouriteInput,
  NodePutFavouriteOutput,
  NodePutGrantInput,
  NodePutGrantOutput,
  NodeThreadCreateInput,
  NodeThreadCreateOutput,
  NodeThreadsInput,
  NodeThreadsOutput,
  NodeVersionContentInput,
  NodeVersionContentOutput,
  NodeVersionCreateInput,
  NodeVersionCreateOutput,
  NodeVersionDeleteInput,
  NodeVersionDeleteOutput,
  NodeVersionPatchInput,
  NodeVersionPatchOutput,
  NodeVersionRestoreInput,
  NodeVersionRestoreOutput,
  NodeVersionsInput,
  NodeVersionsOutput,
  NodeVisitInput,
  NodeVisitOutput,
  NotificationsListInput,
  NotificationsListOutput,
  NotificationsReadAllNotificationsInput,
  NotificationsReadAllNotificationsOutput,
  NotificationsReadNotificationNamesInput,
  NotificationsReadNotificationNamesOutput,
  NotificationsUnreadCountInput,
  NotificationsUnreadCountOutput,
  RootEmptyTrashInput,
  RootEmptyTrashOutput,
  RootPatchRootArchiveInput,
  RootPatchRootArchiveOutput,
  RootPatchRootQuotaInput,
  RootPatchRootQuotaOutput,
  RootPurgeInput,
  RootPurgeOutput,
  RootsDiscoverInput,
  RootsDiscoverOutput,
  RootUsageInput,
  RootUsageOutput,
  SettingsGetInput,
  SettingsGetOutput,
  SettingsPatchInput,
  SettingsPatchOutput,
  SiteSettingsGetInput,
  SiteSettingsGetOutput,
  SiteSettingsPatchInput,
  SiteSettingsPatchOutput,
  ThreadCommentCreateInput,
  ThreadCommentCreateOutput,
  ThreadPatchInput,
  ThreadPatchOutput,
  UploadChunkInput,
  UploadChunkOutput,
  UploadCreateInput,
  UploadCreateOutput,
  UploadFinishInput,
  UploadFinishOutput,
  ViewClearRecentsInput,
  ViewClearRecentsOutput,
  ViewListInput,
  ViewListOutput,
  WebdavGetInput,
  WebdavGetOutput,
} from './generated'

export const operationNodeCreateCreateFolder: Validators<
  NodeCreateCreateFolderInput,
  NodeCreateCreateFolderOutput
> = {
  validateInput(value: unknown): asserts value is NodeCreateCreateFolderInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          kind: { const: 'folder', title: 'Kind', type: 'string' },
          parent_node: { title: 'Parent Node', type: 'string' },
          title: { title: 'Title', type: 'string' },
        },
        required: ['kind', 'parent_node', 'title'],
        additionalProperties: false,
        $defs: {},
      },
      'node_create.create_folder input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeCreateCreateFolderOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
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
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
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
        ],
        title: 'NodeShape',
        type: 'object',
      },
      'node_create.create_folder output',
    )
  },
}

export const operationNodeCreateCreateFile: Validators<
  NodeCreateCreateFileInput,
  NodeCreateCreateFileOutput
> = {
  validateInput(value: unknown): asserts value is NodeCreateCreateFileInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          kind: { const: 'file', title: 'Kind', type: 'string' },
          parent_node: { title: 'Parent Node', type: 'string' },
          title: { title: 'Title', type: 'string' },
          blob: { title: 'Blob', type: 'string' },
          size: { title: 'Size', type: 'integer' },
          mime: { title: 'Mime', type: 'string' },
          content_modified: { title: 'Content Modified', type: 'string' },
        },
        required: ['kind', 'parent_node', 'title', 'blob', 'size', 'mime'],
        additionalProperties: false,
        $defs: {},
      },
      'node_create.create_file input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeCreateCreateFileOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
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
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
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
        ],
        title: 'NodeShape',
        type: 'object',
      },
      'node_create.create_file output',
    )
  },
}

export const operationNodeCreateCreateLink: Validators<
  NodeCreateCreateLinkInput,
  NodeCreateCreateLinkOutput
> = {
  validateInput(value: unknown): asserts value is NodeCreateCreateLinkInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          kind: { const: 'link', title: 'Kind', type: 'string' },
          parent_node: { title: 'Parent Node', type: 'string' },
          title: { title: 'Title', type: 'string' },
          url: { title: 'Url', type: 'string' },
        },
        required: ['kind', 'parent_node', 'title', 'url'],
        additionalProperties: false,
        $defs: {},
      },
      'node_create.create_link input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeCreateCreateLinkOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
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
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
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
        ],
        title: 'NodeShape',
        type: 'object',
      },
      'node_create.create_link output',
    )
  },
}

export const operationNodeCreateCreateDocument: Validators<
  NodeCreateCreateDocumentInput,
  NodeCreateCreateDocumentOutput
> = {
  validateInput(value: unknown): asserts value is NodeCreateCreateDocumentInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          kind: { const: 'document', title: 'Kind', type: 'string' },
          parent_node: { title: 'Parent Node', type: 'string' },
          title: { title: 'Title', type: 'string' },
          content_doctype: { title: 'Content Doctype', type: 'string' },
          from_node: { title: 'From Node', type: 'string' },
          is_template: { title: 'Is Template', type: 'boolean' },
        },
        required: ['kind', 'parent_node', 'title', 'content_doctype'],
        additionalProperties: false,
        $defs: {},
      },
      'node_create.create_document input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeCreateCreateDocumentOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
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
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
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
        ],
        title: 'NodeShape',
        type: 'object',
      },
      'node_create.create_document output',
    )
  },
}

export const operationNodeBatch: Validators<NodeBatchInput, NodeBatchOutput> = {
  validateInput(value: unknown): asserts value is NodeBatchInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          nodes: { items: { type: 'string' }, title: 'Nodes', type: 'array' },
          patch: { $ref: '#/$defs/BatchPatch' },
        },
        required: ['nodes', 'patch'],
        additionalProperties: false,
        $defs: {
          BatchPatch: {
            properties: {
              title: { title: 'Title', type: 'string' },
              parent_node: { title: 'Parent Node', type: 'string' },
              expect_parent_node: { title: 'Expect Parent Node', type: 'string' },
              state: { enum: ['Active', 'Trashed'], title: 'State', type: 'string' },
              content_modified: { title: 'Content Modified', type: 'string' },
            },
            title: 'BatchPatch',
            type: 'object',
          },
        },
      },
      'node_batch input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeBatchOutput {
    assertSchema(
      value,
      {
        $defs: {
          BatchFailure: {
            properties: {
              node: { title: 'Node', type: 'string' },
              type: { title: 'Type', type: 'string' },
              message: { title: 'Message', type: 'string' },
            },
            required: ['node', 'type', 'message'],
            title: 'BatchFailure',
            type: 'object',
          },
        },
        properties: {
          ok: { items: { type: 'string' }, title: 'Ok', type: 'array' },
          failed: { items: { $ref: '#/$defs/BatchFailure' }, title: 'Failed', type: 'array' },
        },
        required: ['ok', 'failed'],
        title: 'BatchResult',
        type: 'object',
      },
      'node_batch output',
    )
  },
}

export const operationNodeBatchPurge: Validators<NodeBatchPurgeInput, NodeBatchPurgeOutput> = {
  validateInput(value: unknown): asserts value is NodeBatchPurgeInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { nodes: { items: { type: 'string' }, title: 'Nodes', type: 'array' } },
        required: ['nodes'],
        additionalProperties: false,
        $defs: {},
      },
      'node_batch_purge input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeBatchPurgeOutput {
    assertSchema(
      value,
      {
        $defs: {
          BatchFailure: {
            properties: {
              node: { title: 'Node', type: 'string' },
              type: { title: 'Type', type: 'string' },
              message: { title: 'Message', type: 'string' },
            },
            required: ['node', 'type', 'message'],
            title: 'BatchFailure',
            type: 'object',
          },
        },
        properties: {
          ok: { items: { type: 'string' }, title: 'Ok', type: 'array' },
          failed: { items: { $ref: '#/$defs/BatchFailure' }, title: 'Failed', type: 'array' },
        },
        required: ['ok', 'failed'],
        title: 'BatchResult',
        type: 'object',
      },
      'node_batch_purge output',
    )
  },
}

export const operationNodeGet: Validators<NodeGetInput, NodeGetOutput> = {
  validateInput(value: unknown): asserts value is NodeGetInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { expand: { title: 'Expand', type: 'string' }, node: { type: 'string' } },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_get input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeGetOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
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
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
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
        ],
        title: 'NodeShape',
        type: 'object',
      },
      'node_get output',
    )
  },
}

export const operationNodePatchRename: Validators<NodePatchRenameInput, NodePatchRenameOutput> = {
  validateInput(value: unknown): asserts value is NodePatchRenameInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { title: { title: 'Title', type: 'string' }, node: { type: 'string' } },
        required: ['title', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_patch.rename input',
    )
  },
  validateOutput(value: unknown): asserts value is NodePatchRenameOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
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
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
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
        ],
        title: 'NodeShape',
        type: 'object',
      },
      'node_patch.rename output',
    )
  },
}

export const operationNodePatchMove: Validators<NodePatchMoveInput, NodePatchMoveOutput> = {
  validateInput(value: unknown): asserts value is NodePatchMoveInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          parent_node: { title: 'Parent Node', type: 'string' },
          expect_parent_node: { title: 'Expect Parent Node', type: 'string' },
          node: { type: 'string' },
        },
        required: ['parent_node', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_patch.move input',
    )
  },
  validateOutput(value: unknown): asserts value is NodePatchMoveOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
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
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
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
        ],
        title: 'NodeShape',
        type: 'object',
      },
      'node_patch.move output',
    )
  },
}

export const operationNodePatchTrash: Validators<NodePatchTrashInput, NodePatchTrashOutput> = {
  validateInput(value: unknown): asserts value is NodePatchTrashInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          state: { const: 'Trashed', title: 'State', type: 'string' },
          node: { type: 'string' },
        },
        required: ['state', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_patch.trash input',
    )
  },
  validateOutput(value: unknown): asserts value is NodePatchTrashOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
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
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
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
        ],
        title: 'NodeShape',
        type: 'object',
      },
      'node_patch.trash output',
    )
  },
}

export const operationNodePatchRestore: Validators<NodePatchRestoreInput, NodePatchRestoreOutput> =
  {
    validateInput(value: unknown): asserts value is NodePatchRestoreInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: {
            state: { const: 'Active', title: 'State', type: 'string' },
            parent_node: { title: 'Parent Node', type: 'string' },
            node: { type: 'string' },
          },
          required: ['state', 'node'],
          additionalProperties: false,
          $defs: {},
        },
        'node_patch.restore input',
      )
    },
    validateOutput(value: unknown): asserts value is NodePatchRestoreOutput {
      assertSchema(
        value,
        {
          $defs: {
            AccessShape: {
              properties: {
                role: { title: 'Role', type: 'integer' },
                via_link: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Via Link' },
                source_node: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                  title: 'Source Node',
                },
                source_principal: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                  title: 'Source Principal',
                },
              },
              title: 'AccessShape',
              type: 'object',
            },
            BreadcrumbShape: {
              properties: {
                name: { title: 'Name', type: 'string' },
                title: { title: 'Title', type: 'string' },
                kind: { title: 'Kind', type: 'string' },
              },
              required: ['name', 'title', 'kind'],
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
            breadcrumbs: {
              items: { $ref: '#/$defs/BreadcrumbShape' },
              title: 'Breadcrumbs',
              type: 'array',
            },
            preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
            opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
            favourite: { title: 'Favourite', type: 'boolean' },
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
          ],
          title: 'NodeShape',
          type: 'object',
        },
        'node_patch.restore output',
      )
    },
  }

export const operationNodePatchStamp: Validators<NodePatchStampInput, NodePatchStampOutput> = {
  validateInput(value: unknown): asserts value is NodePatchStampInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          content_modified: { title: 'Content Modified', type: 'string' },
          node: { type: 'string' },
        },
        required: ['content_modified', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_patch.stamp input',
    )
  },
  validateOutput(value: unknown): asserts value is NodePatchStampOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
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
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
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
        ],
        title: 'NodeShape',
        type: 'object',
      },
      'node_patch.stamp output',
    )
  },
}

export const operationNodePurge: Validators<NodePurgeInput, NodePurgeOutput> = {
  validateInput(value: unknown): asserts value is NodePurgeInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' } },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_purge input',
    )
  },
  validateOutput(value: unknown): asserts value is NodePurgeOutput {
    assertSchema(
      value,
      {
        description:
          'The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).',
        properties: { count: { title: 'Count', type: 'integer' } },
        required: ['count'],
        title: 'Count',
        type: 'object',
      },
      'node_purge output',
    )
  },
}

export const operationNodeChildren: Validators<NodeChildrenInput, NodeChildrenOutput> = {
  validateInput(value: unknown): asserts value is NodeChildrenInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          limit: { title: 'Limit', type: 'integer' },
          cursor: { title: 'Cursor', type: 'string' },
          order_by: { title: 'Order By', type: 'string' },
          ascending: { title: 'Ascending', type: 'boolean' },
          type: { title: 'Type', type: 'string' },
          expand: { title: 'Expand', type: 'string' },
          node: { type: 'string' },
        },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_children input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeChildrenOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
            title: 'BreadcrumbShape',
            type: 'object',
          },
          NodeShape: {
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
              breadcrumbs: {
                items: { $ref: '#/$defs/BreadcrumbShape' },
                title: 'Breadcrumbs',
                type: 'array',
              },
              preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
              opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
              favourite: { title: 'Favourite', type: 'boolean' },
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
            ],
            title: 'NodeShape',
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
        properties: {
          rows: { items: { $ref: '#/$defs/NodeShape' }, title: 'Rows', type: 'array' },
          next_cursor: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Next Cursor' },
        },
        required: ['rows', 'next_cursor'],
        title: 'Page',
        type: 'object',
      },
      'node_children output',
    )
  },
}

export const operationNodeCopy: Validators<NodeCopyInput, NodeCopyOutput> = {
  validateInput(value: unknown): asserts value is NodeCopyInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          parent_node: { title: 'Parent Node', type: 'string' },
          title: { title: 'Title', type: 'string' },
          node: { type: 'string' },
        },
        required: ['parent_node', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_copy input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeCopyOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
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
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
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
        ],
        title: 'NodeShape',
        type: 'object',
      },
      'node_copy output',
    )
  },
}

export const operationNodeArchiveStart: Validators<NodeArchiveStartInput, NodeArchiveStartOutput> =
  {
    validateInput(value: unknown): asserts value is NodeArchiveStartInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: { node: { type: 'string' } },
          required: ['node'],
          additionalProperties: false,
          $defs: {},
        },
        'node_archive_start input',
      )
    },
    validateOutput(value: unknown): asserts value is NodeArchiveStartOutput {
      assertSchema(
        value,
        {
          properties: {
            status: { enum: ['building', 'ready', 'failed'], title: 'Status', type: 'string' },
            file_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'File Name' },
            size: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Size' },
            error: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Error' },
          },
          required: ['status', 'file_name', 'size', 'error'],
          title: 'ArchiveStatus',
          type: 'object',
        },
        'node_archive_start output',
      )
    },
  }

export const operationNodeArchiveStatus: Validators<
  NodeArchiveStatusInput,
  NodeArchiveStatusOutput
> = {
  validateInput(value: unknown): asserts value is NodeArchiveStatusInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' } },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_archive_status input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeArchiveStatusOutput {
    assertSchema(
      value,
      {
        properties: {
          status: { enum: ['building', 'ready', 'failed'], title: 'Status', type: 'string' },
          file_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'File Name' },
          size: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Size' },
          error: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Error' },
        },
        required: ['status', 'file_name', 'size', 'error'],
        title: 'ArchiveStatus',
        type: 'object',
      },
      'node_archive_status output',
    )
  },
}

export const operationNodeArchiveDownload: Validators<
  NodeArchiveDownloadInput,
  NodeArchiveDownloadOutput
> = {
  validateInput(value: unknown): asserts value is NodeArchiveDownloadInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' } },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_archive_download input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeArchiveDownloadOutput {
    if (!(value instanceof Blob)) throw new TypeError('Expected Blob')
  },
}

export const operationNodePutContent: Validators<NodePutContentInput, NodePutContentOutput> = {
  validateInput(value: unknown): asserts value is NodePutContentInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          upload_id: { title: 'Upload Id', type: 'string' },
          checksum: { title: 'Checksum', type: 'string' },
          content_modified: { title: 'Content Modified', type: 'string' },
          node: { type: 'string' },
        },
        required: ['upload_id', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_put_content input',
    )
  },
  validateOutput(value: unknown): asserts value is NodePutContentOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
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
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
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
        ],
        title: 'NodeShape',
        type: 'object',
      },
      'node_put_content output',
    )
  },
}

export const operationNodeGetContent: Validators<NodeGetContentInput, NodeGetContentOutput> = {
  validateInput(value: unknown): asserts value is NodeGetContentInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          format: { title: 'Format', type: 'string' },
          download: { title: 'Download', type: 'boolean' },
          node: { type: 'string' },
        },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_get_content input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeGetContentOutput {
    if (!(value instanceof Blob)) throw new TypeError('Expected Blob')
  },
}

export const operationNodeMedia: Validators<NodeMediaInput, NodeMediaOutput> = {
  validateInput(value: unknown): asserts value is NodeMediaInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' } },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_media input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeMediaOutput {
    assertSchema(
      value,
      {
        $defs: {
          MediaItem: {
            properties: {
              node: { title: 'Node', type: 'string' },
              title: { title: 'Title', type: 'string' },
              mime: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Mime' },
              size: { title: 'Size', type: 'integer' },
              url: { title: 'Url', type: 'string' },
              expires: { title: 'Expires', type: 'integer' },
            },
            required: ['node', 'title', 'mime', 'size', 'url', 'expires'],
            title: 'MediaItem',
            type: 'object',
          },
        },
        properties: {
          media: { items: { $ref: '#/$defs/MediaItem' }, title: 'Media', type: 'array' },
        },
        required: ['media'],
        title: 'MediaList',
        type: 'object',
      },
      'node_media output',
    )
  },
}

export const operationNodePreview: Validators<NodePreviewInput, NodePreviewOutput> = {
  validateInput(value: unknown): asserts value is NodePreviewInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          image: { title: 'Image', type: 'string' },
          mime: { title: 'Mime', type: 'string' },
          node: { type: 'string' },
        },
        required: ['image', 'mime', 'node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_preview input',
    )
  },
  validateOutput(value: unknown): asserts value is NodePreviewOutput {
    assertSchema(
      value,
      {
        $defs: {
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
        properties: { preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] } },
        required: ['preview'],
        title: 'PreviewAnswer',
        type: 'object',
      },
      'node_preview output',
    )
  },
}

export const operationUploadCreate: Validators<UploadCreateInput, UploadCreateOutput> = {
  validateInput(value: unknown): asserts value is UploadCreateInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          parent_node: { title: 'Parent Node', type: 'string' },
          filename: { title: 'Filename', type: 'string' },
          size: { title: 'Size', type: 'integer' },
          mime: { title: 'Mime', type: 'string' },
          replaces: { title: 'Replaces', type: 'string' },
        },
        required: ['parent_node', 'filename', 'size'],
        additionalProperties: false,
        $defs: {},
      },
      'upload_create input',
    )
  },
  validateOutput(value: unknown): asserts value is UploadCreateOutput {
    assertSchema(
      value,
      {
        $defs: {
          ChunkedUpload: {
            description: 'A session that takes its bytes through `PUT /uploads/<id>/chunk`.',
            properties: {
              upload_id: { title: 'Upload Id', type: 'string' },
              mode: { const: 'chunked', title: 'Mode', type: 'string' },
            },
            required: ['upload_id', 'mode'],
            title: 'ChunkedUpload',
            type: 'object',
          },
          DirectUpload: {
            description: 'A session that takes its bytes at the storage `url`, `fields` first.',
            properties: {
              upload_id: { title: 'Upload Id', type: 'string' },
              mode: { const: 'direct', title: 'Mode', type: 'string' },
              url: { title: 'Url', type: 'string' },
              fields: { additionalProperties: { type: 'string' }, title: 'Fields', type: 'object' },
            },
            required: ['upload_id', 'mode', 'url', 'fields'],
            title: 'DirectUpload',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/ChunkedUpload' }, { $ref: '#/$defs/DirectUpload' }],
      },
      'upload_create output',
    )
  },
}

export const operationUploadChunk: Validators<UploadChunkInput, UploadChunkOutput> = {
  validateInput(value: unknown): asserts value is UploadChunkInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          offset: { title: 'Offset', type: 'integer' },
          upload_id: { type: 'string' },
          chunk: {},
        },
        required: ['offset', 'upload_id', 'chunk'],
        additionalProperties: false,
        $defs: {},
      },
      'upload_chunk input',
    )
  },
  validateOutput(value: unknown): asserts value is UploadChunkOutput {
    assertSchema(
      value,
      {
        properties: {
          upload_id: { title: 'Upload Id', type: 'string' },
          received: { title: 'Received', type: 'integer' },
        },
        required: ['upload_id', 'received'],
        title: 'UploadProgress',
        type: 'object',
      },
      'upload_chunk output',
    )
  },
}

export const operationUploadFinish: Validators<UploadFinishInput, UploadFinishOutput> = {
  validateInput(value: unknown): asserts value is UploadFinishInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          parent_node: { title: 'Parent Node', type: 'string' },
          title: { title: 'Title', type: 'string' },
          replaces: { title: 'Replaces', type: 'string' },
          checksum: { title: 'Checksum', type: 'string' },
          content_modified: { title: 'Content Modified', type: 'string' },
          upload_id: { type: 'string' },
        },
        required: ['upload_id'],
        additionalProperties: false,
        $defs: {},
      },
      'upload_finish input',
    )
  },
  validateOutput(value: unknown): asserts value is UploadFinishOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
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
          breadcrumbs: {
            items: { $ref: '#/$defs/BreadcrumbShape' },
            title: 'Breadcrumbs',
            type: 'array',
          },
          preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
          opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
          favourite: { title: 'Favourite', type: 'boolean' },
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
        ],
        title: 'NodeShape',
        type: 'object',
      },
      'upload_finish output',
    )
  },
}

export const operationNodeActivity: Validators<NodeActivityInput, NodeActivityOutput> = {
  validateInput(value: unknown): asserts value is NodeActivityInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          limit: { title: 'Limit', type: 'integer' },
          cursor: { title: 'Cursor', type: 'string' },
          node: { type: 'string' },
        },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_activity input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeActivityOutput {
    assertSchema(
      value,
      {
        $defs: {
          ActivityShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              node: { title: 'Node', type: 'string' },
              action: { title: 'Action', type: 'string' },
              actor: { title: 'Actor', type: 'string' },
              at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'At' },
              via_link: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Via Link' },
              client: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Client' },
              detail: { additionalProperties: true, title: 'Detail', type: 'object' },
            },
            required: ['name', 'node', 'action', 'actor', 'at', 'via_link', 'client', 'detail'],
            title: 'ActivityShape',
            type: 'object',
          },
        },
        properties: {
          rows: { items: { $ref: '#/$defs/ActivityShape' }, title: 'Rows', type: 'array' },
          next_cursor: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Next Cursor' },
        },
        required: ['rows', 'next_cursor'],
        title: 'Page',
        type: 'object',
      },
      'node_activity output',
    )
  },
}

export const operationNodeVisit: Validators<NodeVisitInput, NodeVisitOutput> = {
  validateInput(value: unknown): asserts value is NodeVisitInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' } },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_visit input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeVisitOutput {
    assertSchema(
      value,
      {
        description:
          'The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).',
        properties: { count: { title: 'Count', type: 'integer' } },
        required: ['count'],
        title: 'Count',
        type: 'object',
      },
      'node_visit output',
    )
  },
}

export const operationNodePutFavourite: Validators<NodePutFavouriteInput, NodePutFavouriteOutput> =
  {
    validateInput(value: unknown): asserts value is NodePutFavouriteInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: { node: { type: 'string' } },
          required: ['node'],
          additionalProperties: false,
          $defs: {},
        },
        'node_put_favourite input',
      )
    },
    validateOutput(value: unknown): asserts value is NodePutFavouriteOutput {
      assertSchema(
        value,
        {
          description:
            'The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).',
          properties: { count: { title: 'Count', type: 'integer' } },
          required: ['count'],
          title: 'Count',
          type: 'object',
        },
        'node_put_favourite output',
      )
    },
  }

export const operationNodeDeleteFavourite: Validators<
  NodeDeleteFavouriteInput,
  NodeDeleteFavouriteOutput
> = {
  validateInput(value: unknown): asserts value is NodeDeleteFavouriteInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' } },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_delete_favourite input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeDeleteFavouriteOutput {
    assertSchema(
      value,
      {
        description:
          'The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).',
        properties: { count: { title: 'Count', type: 'integer' } },
        required: ['count'],
        title: 'Count',
        type: 'object',
      },
      'node_delete_favourite output',
    )
  },
}

export const operationNodeGrants: Validators<NodeGrantsInput, NodeGrantsOutput> = {
  validateInput(value: unknown): asserts value is NodeGrantsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          inherited: { title: 'Inherited', type: 'boolean' },
          principal: { title: 'Principal', type: 'string' },
          node: { type: 'string' },
        },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_grants input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeGrantsOutput {
    assertSchema(
      value,
      {
        $defs: {
          ExplainRowShape: {
            properties: {
              node: { title: 'Node', type: 'string' },
              depth: { title: 'Depth', type: 'integer' },
              principal: { title: 'Principal', type: 'string' },
              role: { title: 'Role', type: 'integer' },
              expires_on: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires On' },
              pass: { title: 'Pass', type: 'integer' },
              held: { title: 'Held', type: 'boolean' },
              winner: { title: 'Winner', type: 'boolean' },
            },
            required: [
              'node',
              'depth',
              'principal',
              'role',
              'expires_on',
              'pass',
              'held',
              'winner',
            ],
            title: 'ExplainRowShape',
            type: 'object',
          },
          ExplainShape: {
            properties: {
              role: { title: 'Role', type: 'integer' },
              source: { title: 'Source', type: 'string' },
              rows: { items: { $ref: '#/$defs/ExplainRowShape' }, title: 'Rows', type: 'array' },
            },
            required: ['role', 'source', 'rows'],
            title: 'ExplainShape',
            type: 'object',
          },
          GrantShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              node: { title: 'Node', type: 'string' },
              principal: { title: 'Principal', type: 'string' },
              role: { title: 'Role', type: 'integer' },
              person: { $ref: '#/$defs/Person' },
              expires_on: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires On' },
              has_password: { title: 'Has Password', type: 'boolean' },
              sent_to: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Sent To' },
              url: { title: 'Url', type: 'string' },
            },
            required: [
              'name',
              'node',
              'principal',
              'role',
              'expires_on',
              'has_password',
              'sent_to',
            ],
            title: 'GrantShape',
            type: 'object',
          },
          InheritedGrantShape: {
            properties: {
              grant: {
                anyOf: [{ $ref: '#/$defs/GrantShape' }, { $ref: '#/$defs/RedactedGrantShape' }],
                title: 'Grant',
              },
              redacted: { title: 'Redacted', type: 'boolean' },
              source_node: { title: 'Source Node', type: 'string' },
              source_title: { title: 'Source Title', type: 'string' },
            },
            required: ['grant', 'redacted', 'source_node', 'source_title'],
            title: 'InheritedGrantShape',
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
          RedactedGrantShape: {
            description:
              "An ancestor's link the caller does not manage: no name, URL, or recipient.",
            properties: {
              node: { title: 'Node', type: 'string' },
              principal: { const: '$LINK', title: 'Principal', type: 'string' },
              role: { title: 'Role', type: 'integer' },
              expires_on: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires On' },
              has_password: { title: 'Has Password', type: 'boolean' },
            },
            required: ['node', 'principal', 'role', 'expires_on', 'has_password'],
            title: 'RedactedGrantShape',
            type: 'object',
          },
        },
        description:
          '`GET /nodes/<id>/grants`: the local rows, who owns the tree, and the asked-for extras.',
        properties: {
          grants: { items: { $ref: '#/$defs/GrantShape' }, title: 'Grants', type: 'array' },
          owner: { anyOf: [{ $ref: '#/$defs/Person' }, { type: 'null' }] },
          inherited: {
            items: { $ref: '#/$defs/InheritedGrantShape' },
            title: 'Inherited',
            type: 'array',
          },
          explain: { $ref: '#/$defs/ExplainShape' },
        },
        required: ['grants', 'owner'],
        title: 'GrantsShape',
        type: 'object',
      },
      'node_grants output',
    )
  },
}

export const operationNodePutGrant: Validators<NodePutGrantInput, NodePutGrantOutput> = {
  validateInput(value: unknown): asserts value is NodePutGrantInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          role: { title: 'Role', type: 'integer' },
          expires_on: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires On' },
          password: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Password' },
          send_to: { title: 'Send To', type: 'string' },
          notify: { title: 'Notify', type: 'boolean' },
          node: { type: 'string' },
          principal: { type: 'string' },
        },
        required: ['role', 'node', 'principal'],
        additionalProperties: false,
        $defs: {},
      },
      'node_put_grant input',
    )
  },
  validateOutput(value: unknown): asserts value is NodePutGrantOutput {
    assertSchema(
      value,
      {
        $defs: {
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
        },
        properties: {
          name: { title: 'Name', type: 'string' },
          node: { title: 'Node', type: 'string' },
          principal: { title: 'Principal', type: 'string' },
          role: { title: 'Role', type: 'integer' },
          person: { $ref: '#/$defs/Person' },
          expires_on: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires On' },
          has_password: { title: 'Has Password', type: 'boolean' },
          sent_to: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Sent To' },
          url: { title: 'Url', type: 'string' },
        },
        required: ['name', 'node', 'principal', 'role', 'expires_on', 'has_password', 'sent_to'],
        title: 'GrantShape',
        type: 'object',
      },
      'node_put_grant output',
    )
  },
}

export const operationNodeDeleteGrant: Validators<NodeDeleteGrantInput, NodeDeleteGrantOutput> = {
  validateInput(value: unknown): asserts value is NodeDeleteGrantInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          below: { title: 'Below', type: 'boolean' },
          node: { type: 'string' },
          principal: { type: 'string' },
        },
        required: ['node', 'principal'],
        additionalProperties: false,
        $defs: {},
      },
      'node_delete_grant input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeDeleteGrantOutput {
    assertSchema(
      value,
      {
        description:
          'The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).',
        properties: { count: { title: 'Count', type: 'integer' } },
        required: ['count'],
        title: 'Count',
        type: 'object',
      },
      'node_delete_grant output',
    )
  },
}

export const operationGrantPatch: Validators<GrantPatchInput, GrantPatchOutput> = {
  validateInput(value: unknown): asserts value is GrantPatchInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          role: { title: 'Role', type: 'integer' },
          expires_on: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires On' },
          password: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Password' },
          grant: { type: 'string' },
        },
        required: ['role', 'grant'],
        additionalProperties: false,
        $defs: {},
      },
      'grant_patch input',
    )
  },
  validateOutput(value: unknown): asserts value is GrantPatchOutput {
    assertSchema(
      value,
      {
        $defs: {
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
        },
        properties: {
          name: { title: 'Name', type: 'string' },
          node: { title: 'Node', type: 'string' },
          principal: { title: 'Principal', type: 'string' },
          role: { title: 'Role', type: 'integer' },
          person: { $ref: '#/$defs/Person' },
          expires_on: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires On' },
          has_password: { title: 'Has Password', type: 'boolean' },
          sent_to: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Sent To' },
          url: { title: 'Url', type: 'string' },
        },
        required: ['name', 'node', 'principal', 'role', 'expires_on', 'has_password', 'sent_to'],
        title: 'GrantShape',
        type: 'object',
      },
      'grant_patch output',
    )
  },
}

export const operationGrantDelete: Validators<GrantDeleteInput, GrantDeleteOutput> = {
  validateInput(value: unknown): asserts value is GrantDeleteInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { grant: { type: 'string' } },
        required: ['grant'],
        additionalProperties: false,
        $defs: {},
      },
      'grant_delete input',
    )
  },
  validateOutput(value: unknown): asserts value is GrantDeleteOutput {
    assertSchema(
      value,
      {
        description:
          'The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).',
        properties: { count: { title: 'Count', type: 'integer' } },
        required: ['count'],
        title: 'Count',
        type: 'object',
      },
      'grant_delete output',
    )
  },
}

export const operationGrantRotate: Validators<GrantRotateInput, GrantRotateOutput> = {
  validateInput(value: unknown): asserts value is GrantRotateInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { grant: { type: 'string' } },
        required: ['grant'],
        additionalProperties: false,
        $defs: {},
      },
      'grant_rotate input',
    )
  },
  validateOutput(value: unknown): asserts value is GrantRotateOutput {
    assertSchema(
      value,
      {
        $defs: {
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
        },
        properties: {
          name: { title: 'Name', type: 'string' },
          node: { title: 'Node', type: 'string' },
          principal: { title: 'Principal', type: 'string' },
          role: { title: 'Role', type: 'integer' },
          person: { $ref: '#/$defs/Person' },
          expires_on: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Expires On' },
          has_password: { title: 'Has Password', type: 'boolean' },
          sent_to: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Sent To' },
          url: { title: 'Url', type: 'string' },
        },
        required: ['name', 'node', 'principal', 'role', 'expires_on', 'has_password', 'sent_to'],
        title: 'GrantShape',
        type: 'object',
      },
      'grant_rotate output',
    )
  },
}

export const operationLinkUnlock: Validators<LinkUnlockInput, LinkUnlockOutput> = {
  validateInput(value: unknown): asserts value is LinkUnlockInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          token: { title: 'Token', type: 'string' },
          password: { title: 'Password', type: 'string' },
        },
        required: ['token', 'password'],
        additionalProperties: false,
        $defs: {},
      },
      'link_unlock input',
    )
  },
  validateOutput(value: unknown): asserts value is LinkUnlockOutput {
    assertSchema(
      value,
      {
        properties: {
          ticket: { title: 'Ticket', type: 'string' },
          expires: { title: 'Expires', type: 'integer' },
        },
        required: ['ticket', 'expires'],
        title: 'UnlockTicket',
        type: 'object',
      },
      'link_unlock output',
    )
  },
}

export const operationViewClearRecents: Validators<ViewClearRecentsInput, ViewClearRecentsOutput> =
  {
    validateInput(value: unknown): asserts value is ViewClearRecentsInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: { nodes: { items: { type: 'string' }, title: 'Nodes', type: 'array' } },
          required: [],
          additionalProperties: false,
          $defs: {},
        },
        'view_clear_recents input',
      )
    },
    validateOutput(value: unknown): asserts value is ViewClearRecentsOutput {
      assertSchema(
        value,
        {
          description:
            'The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).',
          properties: { count: { title: 'Count', type: 'integer' } },
          required: ['count'],
          title: 'Count',
          type: 'object',
        },
        'view_clear_recents output',
      )
    },
  }

export const operationViewList: Validators<ViewListInput, ViewListOutput> = {
  validateInput(value: unknown): asserts value is ViewListInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          limit: { title: 'Limit', type: 'integer' },
          cursor: { title: 'Cursor', type: 'string' },
          root: { title: 'Root', type: 'string' },
          content_doctype: { title: 'Content Doctype', type: 'string' },
          term: { title: 'Term', type: 'string' },
          type: { title: 'Type', type: 'string' },
          expand: { title: 'Expand', type: 'string' },
          view: { type: 'string' },
        },
        required: ['view'],
        additionalProperties: false,
        $defs: {},
      },
      'view_list input',
    )
  },
  validateOutput(value: unknown): asserts value is ViewListOutput {
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
            },
            title: 'AccessShape',
            type: 'object',
          },
          ArchivedRootShape: {
            properties: {
              root: { title: 'Root', type: 'string' },
              user: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User' },
              used_bytes: { title: 'Used Bytes', type: 'integer' },
              quota_bytes: { title: 'Quota Bytes', type: 'integer' },
            },
            required: ['root', 'user', 'used_bytes', 'quota_bytes'],
            title: 'ArchivedRootShape',
            type: 'object',
          },
          BreadcrumbShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              title: { title: 'Title', type: 'string' },
              kind: { title: 'Kind', type: 'string' },
            },
            required: ['name', 'title', 'kind'],
            title: 'BreadcrumbShape',
            type: 'object',
          },
          NodeShape: {
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
              breadcrumbs: {
                items: { $ref: '#/$defs/BreadcrumbShape' },
                title: 'Breadcrumbs',
                type: 'array',
              },
              preview: { anyOf: [{ $ref: '#/$defs/PreviewShape' }, { type: 'null' }] },
              opened_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Opened At' },
              favourite: { title: 'Favourite', type: 'boolean' },
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
            ],
            title: 'NodeShape',
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
        properties: {
          rows: {
            items: {
              anyOf: [{ $ref: '#/$defs/NodeShape' }, { $ref: '#/$defs/ArchivedRootShape' }],
            },
            title: 'Rows',
            type: 'array',
          },
          next_cursor: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Next Cursor' },
        },
        required: ['rows', 'next_cursor'],
        title: 'Page',
        type: 'object',
      },
      'view_list output',
    )
  },
}

export const operationNodeVersions: Validators<NodeVersionsInput, NodeVersionsOutput> = {
  validateInput(value: unknown): asserts value is NodeVersionsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          limit: { title: 'Limit', type: 'integer' },
          cursor: { title: 'Cursor', type: 'string' },
          node: { type: 'string' },
        },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_versions input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeVersionsOutput {
    assertSchema(
      value,
      {
        $defs: {
          VersionShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              node: { title: 'Node', type: 'string' },
              seq: { title: 'Seq', type: 'integer' },
              kind: { title: 'Kind', type: 'string' },
              label: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Label' },
              pinned: { title: 'Pinned', type: 'integer' },
              actor: { title: 'Actor', type: 'string' },
              size: { title: 'Size', type: 'integer' },
              creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
            },
            required: [
              'name',
              'node',
              'seq',
              'kind',
              'label',
              'pinned',
              'actor',
              'size',
              'creation',
            ],
            title: 'VersionShape',
            type: 'object',
          },
        },
        properties: {
          rows: { items: { $ref: '#/$defs/VersionShape' }, title: 'Rows', type: 'array' },
          next_cursor: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Next Cursor' },
        },
        required: ['rows', 'next_cursor'],
        title: 'Page',
        type: 'object',
      },
      'node_versions output',
    )
  },
}

export const operationNodeVersionCreate: Validators<
  NodeVersionCreateInput,
  NodeVersionCreateOutput
> = {
  validateInput(value: unknown): asserts value is NodeVersionCreateInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          kind: { enum: ['auto', 'named', 'milestone'], title: 'Kind', type: 'string' },
          label: { title: 'Label', type: 'string' },
          node: { type: 'string' },
        },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_version_create input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeVersionCreateOutput {
    assertSchema(
      value,
      {
        properties: {
          name: { title: 'Name', type: 'string' },
          node: { title: 'Node', type: 'string' },
          seq: { title: 'Seq', type: 'integer' },
          kind: { title: 'Kind', type: 'string' },
          label: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Label' },
          pinned: { title: 'Pinned', type: 'integer' },
          actor: { title: 'Actor', type: 'string' },
          size: { title: 'Size', type: 'integer' },
          creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
        },
        required: ['name', 'node', 'seq', 'kind', 'label', 'pinned', 'actor', 'size', 'creation'],
        title: 'VersionShape',
        type: 'object',
      },
      'node_version_create output',
    )
  },
}

export const operationNodeVersionPatch: Validators<NodeVersionPatchInput, NodeVersionPatchOutput> =
  {
    validateInput(value: unknown): asserts value is NodeVersionPatchInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: {
            label: { title: 'Label', type: 'string' },
            pinned: { title: 'Pinned', type: 'boolean' },
            node: { type: 'string' },
            seq: { type: 'string' },
          },
          required: ['node', 'seq'],
          additionalProperties: false,
          $defs: {},
        },
        'node_version_patch input',
      )
    },
    validateOutput(value: unknown): asserts value is NodeVersionPatchOutput {
      assertSchema(
        value,
        {
          properties: {
            name: { title: 'Name', type: 'string' },
            node: { title: 'Node', type: 'string' },
            seq: { title: 'Seq', type: 'integer' },
            kind: { title: 'Kind', type: 'string' },
            label: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Label' },
            pinned: { title: 'Pinned', type: 'integer' },
            actor: { title: 'Actor', type: 'string' },
            size: { title: 'Size', type: 'integer' },
            creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
          },
          required: ['name', 'node', 'seq', 'kind', 'label', 'pinned', 'actor', 'size', 'creation'],
          title: 'VersionShape',
          type: 'object',
        },
        'node_version_patch output',
      )
    },
  }

export const operationNodeVersionDelete: Validators<
  NodeVersionDeleteInput,
  NodeVersionDeleteOutput
> = {
  validateInput(value: unknown): asserts value is NodeVersionDeleteInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' }, seq: { type: 'string' } },
        required: ['node', 'seq'],
        additionalProperties: false,
        $defs: {},
      },
      'node_version_delete input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeVersionDeleteOutput {
    assertSchema(
      value,
      {
        description:
          'The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).',
        properties: { count: { title: 'Count', type: 'integer' } },
        required: ['count'],
        title: 'Count',
        type: 'object',
      },
      'node_version_delete output',
    )
  },
}

export const operationNodeVersionContent: Validators<
  NodeVersionContentInput,
  NodeVersionContentOutput
> = {
  validateInput(value: unknown): asserts value is NodeVersionContentInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' }, seq: { type: 'string' } },
        required: ['node', 'seq'],
        additionalProperties: false,
        $defs: {},
      },
      'node_version_content input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeVersionContentOutput {
    if (!(value instanceof Blob)) throw new TypeError('Expected Blob')
  },
}

export const operationNodeVersionRestore: Validators<
  NodeVersionRestoreInput,
  NodeVersionRestoreOutput
> = {
  validateInput(value: unknown): asserts value is NodeVersionRestoreInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { node: { type: 'string' }, seq: { type: 'string' } },
        required: ['node', 'seq'],
        additionalProperties: false,
        $defs: {},
      },
      'node_version_restore input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeVersionRestoreOutput {
    assertSchema(
      value,
      {
        $defs: {
          VersionShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              node: { title: 'Node', type: 'string' },
              seq: { title: 'Seq', type: 'integer' },
              kind: { title: 'Kind', type: 'string' },
              label: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Label' },
              pinned: { title: 'Pinned', type: 'integer' },
              actor: { title: 'Actor', type: 'string' },
              size: { title: 'Size', type: 'integer' },
              creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
            },
            required: [
              'name',
              'node',
              'seq',
              'kind',
              'label',
              'pinned',
              'actor',
              'size',
              'creation',
            ],
            title: 'VersionShape',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/VersionShape' }, { type: 'null' }],
      },
      'node_version_restore output',
    )
  },
}

export const operationNodeThreads: Validators<NodeThreadsInput, NodeThreadsOutput> = {
  validateInput(value: unknown): asserts value is NodeThreadsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { resolved: { title: 'Resolved', type: 'boolean' }, node: { type: 'string' } },
        required: ['node'],
        additionalProperties: false,
        $defs: {},
      },
      'node_threads input',
    )
  },
  validateOutput(value: unknown): asserts value is NodeThreadsOutput {
    assertSchema(
      value,
      {
        $defs: {
          CommentShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              thread: { title: 'Thread', type: 'string' },
              node: { title: 'Node', type: 'string' },
              content: { title: 'Content', type: 'string' },
              author: { title: 'Author', type: 'string' },
              author_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Author Name' },
              person: { $ref: '#/$defs/Person' },
              mentions: { items: { type: 'string' }, title: 'Mentions', type: 'array' },
              creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
              modified: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Modified' },
            },
            required: [
              'name',
              'thread',
              'node',
              'content',
              'author',
              'author_name',
              'mentions',
              'creation',
              'modified',
            ],
            title: 'CommentShape',
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
          ThreadShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              node: { title: 'Node', type: 'string' },
              anchor: { title: 'Anchor', type: 'string' },
              resolved: { title: 'Resolved', type: 'boolean' },
              resolved_by: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Resolved By' },
              resolved_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Resolved At' },
              creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
              comments: {
                items: { $ref: '#/$defs/CommentShape' },
                title: 'Comments',
                type: 'array',
              },
            },
            required: [
              'name',
              'node',
              'anchor',
              'resolved',
              'resolved_by',
              'resolved_at',
              'creation',
              'comments',
            ],
            title: 'ThreadShape',
            type: 'object',
          },
        },
        properties: {
          threads: { items: { $ref: '#/$defs/ThreadShape' }, title: 'Threads', type: 'array' },
        },
        required: ['threads'],
        title: 'ThreadList',
        type: 'object',
      },
      'node_threads output',
    )
  },
}

export const operationNodeThreadCreate: Validators<NodeThreadCreateInput, NodeThreadCreateOutput> =
  {
    validateInput(value: unknown): asserts value is NodeThreadCreateInput {
      assertSchema(
        value,
        {
          type: 'object',
          properties: {
            anchor: { title: 'Anchor', type: 'string' },
            text: { title: 'Text', type: 'string' },
            author_name: { title: 'Author Name', type: 'string' },
            node: { type: 'string' },
          },
          required: ['anchor', 'text', 'node'],
          additionalProperties: false,
          $defs: {},
        },
        'node_thread_create input',
      )
    },
    validateOutput(value: unknown): asserts value is NodeThreadCreateOutput {
      assertSchema(
        value,
        {
          $defs: {
            CommentShape: {
              properties: {
                name: { title: 'Name', type: 'string' },
                thread: { title: 'Thread', type: 'string' },
                node: { title: 'Node', type: 'string' },
                content: { title: 'Content', type: 'string' },
                author: { title: 'Author', type: 'string' },
                author_name: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                  title: 'Author Name',
                },
                person: { $ref: '#/$defs/Person' },
                mentions: { items: { type: 'string' }, title: 'Mentions', type: 'array' },
                creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
                modified: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Modified' },
              },
              required: [
                'name',
                'thread',
                'node',
                'content',
                'author',
                'author_name',
                'mentions',
                'creation',
                'modified',
              ],
              title: 'CommentShape',
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
          },
          properties: {
            name: { title: 'Name', type: 'string' },
            node: { title: 'Node', type: 'string' },
            anchor: { title: 'Anchor', type: 'string' },
            resolved: { title: 'Resolved', type: 'boolean' },
            resolved_by: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Resolved By' },
            resolved_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Resolved At' },
            creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
            comments: { items: { $ref: '#/$defs/CommentShape' }, title: 'Comments', type: 'array' },
          },
          required: [
            'name',
            'node',
            'anchor',
            'resolved',
            'resolved_by',
            'resolved_at',
            'creation',
            'comments',
          ],
          title: 'ThreadShape',
          type: 'object',
        },
        'node_thread_create output',
      )
    },
  }

export const operationThreadPatch: Validators<ThreadPatchInput, ThreadPatchOutput> = {
  validateInput(value: unknown): asserts value is ThreadPatchInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          resolved: { title: 'Resolved', type: 'boolean' },
          thread: { type: 'string' },
        },
        required: ['resolved', 'thread'],
        additionalProperties: false,
        $defs: {},
      },
      'thread_patch input',
    )
  },
  validateOutput(value: unknown): asserts value is ThreadPatchOutput {
    assertSchema(
      value,
      {
        $defs: {
          CommentShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              thread: { title: 'Thread', type: 'string' },
              node: { title: 'Node', type: 'string' },
              content: { title: 'Content', type: 'string' },
              author: { title: 'Author', type: 'string' },
              author_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Author Name' },
              person: { $ref: '#/$defs/Person' },
              mentions: { items: { type: 'string' }, title: 'Mentions', type: 'array' },
              creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
              modified: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Modified' },
            },
            required: [
              'name',
              'thread',
              'node',
              'content',
              'author',
              'author_name',
              'mentions',
              'creation',
              'modified',
            ],
            title: 'CommentShape',
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
        },
        properties: {
          name: { title: 'Name', type: 'string' },
          node: { title: 'Node', type: 'string' },
          anchor: { title: 'Anchor', type: 'string' },
          resolved: { title: 'Resolved', type: 'boolean' },
          resolved_by: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Resolved By' },
          resolved_at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Resolved At' },
          creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
          comments: { items: { $ref: '#/$defs/CommentShape' }, title: 'Comments', type: 'array' },
        },
        required: [
          'name',
          'node',
          'anchor',
          'resolved',
          'resolved_by',
          'resolved_at',
          'creation',
          'comments',
        ],
        title: 'ThreadShape',
        type: 'object',
      },
      'thread_patch output',
    )
  },
}

export const operationThreadCommentCreate: Validators<
  ThreadCommentCreateInput,
  ThreadCommentCreateOutput
> = {
  validateInput(value: unknown): asserts value is ThreadCommentCreateInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          text: { title: 'Text', type: 'string' },
          author_name: { title: 'Author Name', type: 'string' },
          thread: { type: 'string' },
        },
        required: ['text', 'thread'],
        additionalProperties: false,
        $defs: {},
      },
      'thread_comment_create input',
    )
  },
  validateOutput(value: unknown): asserts value is ThreadCommentCreateOutput {
    assertSchema(
      value,
      {
        $defs: {
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
        },
        properties: {
          name: { title: 'Name', type: 'string' },
          thread: { title: 'Thread', type: 'string' },
          node: { title: 'Node', type: 'string' },
          content: { title: 'Content', type: 'string' },
          author: { title: 'Author', type: 'string' },
          author_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Author Name' },
          person: { $ref: '#/$defs/Person' },
          mentions: { items: { type: 'string' }, title: 'Mentions', type: 'array' },
          creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
          modified: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Modified' },
        },
        required: [
          'name',
          'thread',
          'node',
          'content',
          'author',
          'author_name',
          'mentions',
          'creation',
          'modified',
        ],
        title: 'CommentShape',
        type: 'object',
      },
      'thread_comment_create output',
    )
  },
}

export const operationCommentPatch: Validators<CommentPatchInput, CommentPatchOutput> = {
  validateInput(value: unknown): asserts value is CommentPatchInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { text: { title: 'Text', type: 'string' }, comment: { type: 'string' } },
        required: ['text', 'comment'],
        additionalProperties: false,
        $defs: {},
      },
      'comment_patch input',
    )
  },
  validateOutput(value: unknown): asserts value is CommentPatchOutput {
    assertSchema(
      value,
      {
        $defs: {
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
        },
        properties: {
          name: { title: 'Name', type: 'string' },
          thread: { title: 'Thread', type: 'string' },
          node: { title: 'Node', type: 'string' },
          content: { title: 'Content', type: 'string' },
          author: { title: 'Author', type: 'string' },
          author_name: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Author Name' },
          person: { $ref: '#/$defs/Person' },
          mentions: { items: { type: 'string' }, title: 'Mentions', type: 'array' },
          creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
          modified: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Modified' },
        },
        required: [
          'name',
          'thread',
          'node',
          'content',
          'author',
          'author_name',
          'mentions',
          'creation',
          'modified',
        ],
        title: 'CommentShape',
        type: 'object',
      },
      'comment_patch output',
    )
  },
}

export const operationCommentDelete: Validators<CommentDeleteInput, CommentDeleteOutput> = {
  validateInput(value: unknown): asserts value is CommentDeleteInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { comment: { type: 'string' } },
        required: ['comment'],
        additionalProperties: false,
        $defs: {},
      },
      'comment_delete input',
    )
  },
  validateOutput(value: unknown): asserts value is CommentDeleteOutput {
    assertSchema(
      value,
      {
        description:
          'The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).',
        properties: { count: { title: 'Count', type: 'integer' } },
        required: ['count'],
        title: 'Count',
        type: 'object',
      },
      'comment_delete output',
    )
  },
}

export const operationNotificationsList: Validators<
  NotificationsListInput,
  NotificationsListOutput
> = {
  validateInput(value: unknown): asserts value is NotificationsListInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          limit: { title: 'Limit', type: 'integer' },
          cursor: { title: 'Cursor', type: 'string' },
          unread: { title: 'Unread', type: 'boolean' },
        },
        required: [],
        additionalProperties: false,
        $defs: {},
      },
      'notifications_list input',
    )
  },
  validateOutput(value: unknown): asserts value is NotificationsListOutput {
    assertSchema(
      value,
      {
        $defs: {
          ActivityShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              node: { title: 'Node', type: 'string' },
              action: { title: 'Action', type: 'string' },
              actor: { title: 'Actor', type: 'string' },
              at: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'At' },
              via_link: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Via Link' },
              client: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Client' },
              detail: { additionalProperties: true, title: 'Detail', type: 'object' },
            },
            required: ['name', 'node', 'action', 'actor', 'at', 'via_link', 'client', 'detail'],
            title: 'ActivityShape',
            type: 'object',
          },
          NotificationShape: {
            properties: {
              name: { title: 'Name', type: 'string' },
              read: { title: 'Read', type: 'integer' },
              creation: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Creation' },
              activity: { $ref: '#/$defs/ActivityShape' },
            },
            required: ['name', 'read', 'creation', 'activity'],
            title: 'NotificationShape',
            type: 'object',
          },
        },
        properties: {
          rows: { items: { $ref: '#/$defs/NotificationShape' }, title: 'Rows', type: 'array' },
          next_cursor: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Next Cursor' },
        },
        required: ['rows', 'next_cursor'],
        title: 'Page',
        type: 'object',
      },
      'notifications_list output',
    )
  },
}

export const operationNotificationsUnreadCount: Validators<
  NotificationsUnreadCountInput,
  NotificationsUnreadCountOutput
> = {
  validateInput(value: unknown): asserts value is NotificationsUnreadCountInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'notifications_unread_count input',
    )
  },
  validateOutput(value: unknown): asserts value is NotificationsUnreadCountOutput {
    assertSchema(
      value,
      {
        properties: { unread: { title: 'Unread', type: 'integer' } },
        required: ['unread'],
        title: 'UnreadCount',
        type: 'object',
      },
      'notifications_unread_count output',
    )
  },
}

export const operationNotificationsReadNotificationNames: Validators<
  NotificationsReadNotificationNamesInput,
  NotificationsReadNotificationNamesOutput
> = {
  validateInput(value: unknown): asserts value is NotificationsReadNotificationNamesInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          notifications: { items: { type: 'string' }, title: 'Notifications', type: 'array' },
        },
        required: ['notifications'],
        additionalProperties: false,
        $defs: {},
      },
      'notifications_read.notification_names input',
    )
  },
  validateOutput(value: unknown): asserts value is NotificationsReadNotificationNamesOutput {
    assertSchema(
      value,
      {
        description:
          'The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).',
        properties: { count: { title: 'Count', type: 'integer' } },
        required: ['count'],
        title: 'Count',
        type: 'object',
      },
      'notifications_read.notification_names output',
    )
  },
}

export const operationNotificationsReadAllNotifications: Validators<
  NotificationsReadAllNotificationsInput,
  NotificationsReadAllNotificationsOutput
> = {
  validateInput(value: unknown): asserts value is NotificationsReadAllNotificationsInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { all: { const: true, title: 'All', type: 'boolean' } },
        required: ['all'],
        additionalProperties: false,
        $defs: {},
      },
      'notifications_read.all_notifications input',
    )
  },
  validateOutput(value: unknown): asserts value is NotificationsReadAllNotificationsOutput {
    assertSchema(
      value,
      {
        description:
          'The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).',
        properties: { count: { title: 'Count', type: 'integer' } },
        required: ['count'],
        title: 'Count',
        type: 'object',
      },
      'notifications_read.all_notifications output',
    )
  },
}

export const operationRootsDiscover: Validators<RootsDiscoverInput, RootsDiscoverOutput> = {
  validateInput(value: unknown): asserts value is RootsDiscoverInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'roots_discover input',
    )
  },
  validateOutput(value: unknown): asserts value is RootsDiscoverOutput {
    assertSchema(
      value,
      {
        $defs: {
          RootLocation: {
            properties: {
              node: { title: 'Node', type: 'string' },
              title: { title: 'Title', type: 'string' },
            },
            required: ['node', 'title'],
            title: 'RootLocation',
            type: 'object',
          },
        },
        properties: {
          personal: { $ref: '#/$defs/RootLocation' },
          organization: { anyOf: [{ $ref: '#/$defs/RootLocation' }, { type: 'null' }] },
        },
        required: ['personal', 'organization'],
        title: 'RootLocations',
        type: 'object',
      },
      'roots_discover output',
    )
  },
}

export const operationRootUsage: Validators<RootUsageInput, RootUsageOutput> = {
  validateInput(value: unknown): asserts value is RootUsageInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          expand: { const: 'breakdown', title: 'Expand', type: 'string' },
          root: { type: 'string' },
        },
        required: ['root'],
        additionalProperties: false,
        $defs: {},
      },
      'root_usage input',
    )
  },
  validateOutput(value: unknown): asserts value is RootUsageOutput {
    assertSchema(
      value,
      {
        $defs: {
          LargestNode: {
            properties: {
              node: { title: 'Node', type: 'string' },
              title: { title: 'Title', type: 'string' },
              size: { title: 'Size', type: 'integer' },
              mime: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Mime' },
              kind: { enum: ['file', 'document'], title: 'Kind', type: 'string' },
              type: { title: 'Type', type: 'string' },
            },
            required: ['node', 'title', 'size', 'mime', 'kind', 'type'],
            title: 'LargestNode',
            type: 'object',
          },
          TypeBytes: {
            properties: {
              type: { title: 'Type', type: 'string' },
              bytes: { title: 'Bytes', type: 'integer' },
            },
            required: ['type', 'bytes'],
            title: 'TypeBytes',
            type: 'object',
          },
        },
        properties: {
          used_bytes: { title: 'Used Bytes', type: 'integer' },
          reserved_bytes: { title: 'Reserved Bytes', type: 'integer' },
          quota_bytes: { anyOf: [{ type: 'integer' }, { type: 'null' }], title: 'Quota Bytes' },
          effective_quota: { title: 'Effective Quota', type: 'integer' },
          by_type: { items: { $ref: '#/$defs/TypeBytes' }, title: 'By Type', type: 'array' },
          largest: { items: { $ref: '#/$defs/LargestNode' }, title: 'Largest', type: 'array' },
        },
        required: ['used_bytes', 'reserved_bytes', 'quota_bytes', 'effective_quota'],
        title: 'RootUsage',
        type: 'object',
      },
      'root_usage output',
    )
  },
}

export const operationRootPatchRootQuota: Validators<
  RootPatchRootQuotaInput,
  RootPatchRootQuotaOutput
> = {
  validateInput(value: unknown): asserts value is RootPatchRootQuotaInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          quota_bytes: { title: 'Quota Bytes', type: 'integer' },
          root: { type: 'string' },
        },
        required: ['quota_bytes', 'root'],
        additionalProperties: false,
        $defs: {},
      },
      'root_patch.root_quota input',
    )
  },
  validateOutput(value: unknown): asserts value is RootPatchRootQuotaOutput {
    assertSchema(
      value,
      {
        description: "One `Drive Root` with its node's title, as `PATCH /roots/<id>` answers it.",
        properties: {
          name: { title: 'Name', type: 'string' },
          node: { title: 'Node', type: 'string' },
          kind: { title: 'Kind', type: 'string' },
          user: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User' },
          state: { title: 'State', type: 'string' },
          quota_bytes: { title: 'Quota Bytes', type: 'integer' },
          used_bytes: { title: 'Used Bytes', type: 'integer' },
          title: { title: 'Title', type: 'string' },
        },
        required: ['name', 'node', 'kind', 'user', 'state', 'quota_bytes', 'used_bytes', 'title'],
        title: 'RootShape',
        type: 'object',
      },
      'root_patch.root_quota output',
    )
  },
}

export const operationRootPatchRootArchive: Validators<
  RootPatchRootArchiveInput,
  RootPatchRootArchiveOutput
> = {
  validateInput(value: unknown): asserts value is RootPatchRootArchiveInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: {
          state: { const: 'Archived', title: 'State', type: 'string' },
          root: { type: 'string' },
        },
        required: ['state', 'root'],
        additionalProperties: false,
        $defs: {},
      },
      'root_patch.root_archive input',
    )
  },
  validateOutput(value: unknown): asserts value is RootPatchRootArchiveOutput {
    assertSchema(
      value,
      {
        description: "One `Drive Root` with its node's title, as `PATCH /roots/<id>` answers it.",
        properties: {
          name: { title: 'Name', type: 'string' },
          node: { title: 'Node', type: 'string' },
          kind: { title: 'Kind', type: 'string' },
          user: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'User' },
          state: { title: 'State', type: 'string' },
          quota_bytes: { title: 'Quota Bytes', type: 'integer' },
          used_bytes: { title: 'Used Bytes', type: 'integer' },
          title: { title: 'Title', type: 'string' },
        },
        required: ['name', 'node', 'kind', 'user', 'state', 'quota_bytes', 'used_bytes', 'title'],
        title: 'RootShape',
        type: 'object',
      },
      'root_patch.root_archive output',
    )
  },
}

export const operationRootPurge: Validators<RootPurgeInput, RootPurgeOutput> = {
  validateInput(value: unknown): asserts value is RootPurgeInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { root: { type: 'string' } },
        required: ['root'],
        additionalProperties: false,
        $defs: {},
      },
      'root_purge input',
    )
  },
  validateOutput(value: unknown): asserts value is RootPurgeOutput {
    assertSchema(
      value,
      {
        description:
          'The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).',
        properties: { count: { title: 'Count', type: 'integer' } },
        required: ['count'],
        title: 'Count',
        type: 'object',
      },
      'root_purge output',
    )
  },
}

export const operationRootEmptyTrash: Validators<RootEmptyTrashInput, RootEmptyTrashOutput> = {
  validateInput(value: unknown): asserts value is RootEmptyTrashInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { root: { type: 'string' } },
        required: ['root'],
        additionalProperties: false,
        $defs: {},
      },
      'root_empty_trash input',
    )
  },
  validateOutput(value: unknown): asserts value is RootEmptyTrashOutput {
    assertSchema(
      value,
      {
        description:
          'The answer to a write that removes or touches rows rather than shaping one.\n\nEvery delete answers it, and so does a write whose only result is a\nnumber of rows: a visit, a star, a read receipt (`http/__init__.py`).',
        properties: { count: { title: 'Count', type: 'integer' } },
        required: ['count'],
        title: 'Count',
        type: 'object',
      },
      'root_empty_trash output',
    )
  },
}

export const operationSettingsGet: Validators<SettingsGetInput, SettingsGetOutput> = {
  validateInput(value: unknown): asserts value is SettingsGetInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'settings_get input',
    )
  },
  validateOutput(value: unknown): asserts value is SettingsGetOutput {
    assertSchema(
      value,
      {
        description: "The caller's own `Drive Settings` row (§3.14), or its field defaults.",
        properties: {
          webdav_enabled: { title: 'Webdav Enabled', type: 'boolean' },
          writer_settings: { additionalProperties: true, title: 'Writer Settings', type: 'object' },
        },
        required: ['webdav_enabled', 'writer_settings'],
        title: 'UserSettings',
        type: 'object',
      },
      'settings_get output',
    )
  },
}

export const operationSettingsPatch: Validators<SettingsPatchInput, SettingsPatchOutput> = {
  validateInput(value: unknown): asserts value is SettingsPatchInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { webdav_enabled: { title: 'Webdav Enabled', type: 'boolean' } },
        required: ['webdav_enabled'],
        additionalProperties: false,
        $defs: {},
      },
      'settings_patch input',
    )
  },
  validateOutput(value: unknown): asserts value is SettingsPatchOutput {
    assertSchema(
      value,
      {
        description: "The caller's own `Drive Settings` row (§3.14), or its field defaults.",
        properties: {
          webdav_enabled: { title: 'Webdav Enabled', type: 'boolean' },
          writer_settings: { additionalProperties: true, title: 'Writer Settings', type: 'object' },
        },
        required: ['webdav_enabled', 'writer_settings'],
        title: 'UserSettings',
        type: 'object',
      },
      'settings_patch output',
    )
  },
}

export const operationSiteSettingsGet: Validators<SiteSettingsGetInput, SiteSettingsGetOutput> = {
  validateInput(value: unknown): asserts value is SiteSettingsGetInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'site_settings_get input',
    )
  },
  validateOutput(value: unknown): asserts value is SiteSettingsGetOutput {
    assertSchema(
      value,
      {
        $defs: {
          AdminSiteSettings: {
            description: 'What a Drive admin reads. Quotas are bytes, and 0 is unlimited.',
            properties: {
              is_admin: { title: 'Is Admin', type: 'boolean' },
              preview_size: { title: 'Preview Size', type: 'integer' },
              webdav_enabled: { title: 'Webdav Enabled', type: 'boolean' },
              webdav_allowed_methods: { title: 'Webdav Allowed Methods', type: 'string' },
              default_personal_quota: { title: 'Default Personal Quota', type: 'integer' },
              shared_quota: { title: 'Shared Quota', type: 'integer' },
            },
            required: [
              'is_admin',
              'preview_size',
              'webdav_enabled',
              'webdav_allowed_methods',
              'default_personal_quota',
              'shared_quota',
            ],
            title: 'AdminSiteSettings',
            type: 'object',
          },
          SiteSettings: {
            description: 'What every signed-in caller reads from `Drive Disk Settings` (§3.13).',
            properties: {
              is_admin: { title: 'Is Admin', type: 'boolean' },
              preview_size: { title: 'Preview Size', type: 'integer' },
            },
            required: ['is_admin', 'preview_size'],
            title: 'SiteSettings',
            type: 'object',
          },
        },
        anyOf: [{ $ref: '#/$defs/SiteSettings' }, { $ref: '#/$defs/AdminSiteSettings' }],
      },
      'site_settings_get output',
    )
  },
}

export const operationSiteSettingsPatch: Validators<
  SiteSettingsPatchInput,
  SiteSettingsPatchOutput
> = {
  validateInput(value: unknown): asserts value is SiteSettingsPatchInput {
    assertSchema(
      value,
      {
        type: 'object',
        properties: { webdav_enabled: { title: 'Webdav Enabled', type: 'boolean' } },
        required: ['webdav_enabled'],
        additionalProperties: false,
        $defs: {},
      },
      'site_settings_patch input',
    )
  },
  validateOutput(value: unknown): asserts value is SiteSettingsPatchOutput {
    assertSchema(
      value,
      {
        description: 'What a Drive admin reads. Quotas are bytes, and 0 is unlimited.',
        properties: {
          is_admin: { title: 'Is Admin', type: 'boolean' },
          preview_size: { title: 'Preview Size', type: 'integer' },
          webdav_enabled: { title: 'Webdav Enabled', type: 'boolean' },
          webdav_allowed_methods: { title: 'Webdav Allowed Methods', type: 'string' },
          default_personal_quota: { title: 'Default Personal Quota', type: 'integer' },
          shared_quota: { title: 'Shared Quota', type: 'integer' },
        },
        required: [
          'is_admin',
          'preview_size',
          'webdav_enabled',
          'webdav_allowed_methods',
          'default_personal_quota',
          'shared_quota',
        ],
        title: 'AdminSiteSettings',
        type: 'object',
      },
      'site_settings_patch output',
    )
  },
}

export const operationWebdavGet: Validators<WebdavGetInput, WebdavGetOutput> = {
  validateInput(value: unknown): asserts value is WebdavGetInput {
    assertSchema(
      value,
      { type: 'object', properties: {}, required: [], additionalProperties: false, $defs: {} },
      'webdav_get input',
    )
  },
  validateOutput(value: unknown): asserts value is WebdavGetOutput {
    assertSchema(
      value,
      {
        $defs: {
          WebdavConnection: {
            additionalProperties: false,
            description:
              'How to mount `/dav/` while the site switch is on. Closed, as `WebdavOff`.\n\n`api_key` doubles as the DAV username for key-based sign-in. The secret is\nminted once by `suite.utils.user.generate_user_keys` and never read back.',
            properties: {
              globally_enabled: { title: 'Globally Enabled', type: 'boolean' },
              is_admin: { title: 'Is Admin', type: 'boolean' },
              server_url: { title: 'Server Url', type: 'string' },
              username: { title: 'Username', type: 'string' },
              enabled_for_user: { title: 'Enabled For User', type: 'boolean' },
              two_factor_blocked: { title: 'Two Factor Blocked', type: 'boolean' },
              api_key: { anyOf: [{ type: 'string' }, { type: 'null' }], title: 'Api Key' },
            },
            required: [
              'globally_enabled',
              'is_admin',
              'server_url',
              'username',
              'enabled_for_user',
              'two_factor_blocked',
              'api_key',
            ],
            title: 'WebdavConnection',
            type: 'object',
          },
          WebdavHidden: {
            additionalProperties: false,
            description: 'WebDAV is off for the site and the caller is no admin: nothing to show.',
            properties: {},
            title: 'WebdavHidden',
            type: 'object',
          },
          WebdavOff: {
            additionalProperties: false,
            description: 'The site switch, shown to an admin while it is off.',
            properties: {
              globally_enabled: { title: 'Globally Enabled', type: 'boolean' },
              is_admin: { title: 'Is Admin', type: 'boolean' },
            },
            required: ['globally_enabled', 'is_admin'],
            title: 'WebdavOff',
            type: 'object',
          },
        },
        anyOf: [
          { $ref: '#/$defs/WebdavHidden' },
          { $ref: '#/$defs/WebdavOff' },
          { $ref: '#/$defs/WebdavConnection' },
        ],
      },
      'webdav_get output',
    )
  },
}
