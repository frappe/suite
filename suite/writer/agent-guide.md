# Working on a document as an agent

How an agent, or any script, finds, writes, reads and shares a Writer document with no tab open. A write takes Markdown, and a read gives Markdown back.

## The loop

Sign in as the user the agent works for, here with an API key. History and versions name that user. The calls below use:

```sh
SITE=https://suite.example.com
AUTH='Authorization: token <api_key>:<api_secret>'
```

**1. Find home.** `personal` is the user's own Drive, and `organization` the shared one when the user has it.

```sh
curl -H "$AUTH" $SITE/api/suite/drive/roots
```

```json
{ "data": { "personal": { "node": "84kgnp5ehu", "title": "My Drive" }, "organization": null } }
```

**2. Find a folder or a document.** List a folder, or search by title.

```sh
curl -H "$AUTH" $SITE/api/suite/drive/nodes/<folder node>/children
curl -H "$AUTH" "$SITE/api/suite/drive/views/search?term=plan"
```

Both answer rows, shown here with the fields an agent needs. `name` is the node id every other call takes. A folder has `"kind": "folder"`, and a Writer document `"kind": "document"` with `"mime": "frappe/writer"`. When `next_cursor` is not null, send it as `cursor` for the next rows.

```json
{ "data": { "rows": [{ "name": "84n0kmpagb", "title": "Plans", "kind": "folder", "parent_node": "84kgnp5ehu", "mime": null }], "next_cursor": null } }
```

**3. Create a document** in a folder. The user needs upload access to it.

```sh
curl -X POST $SITE/api/suite/writer/documents -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"parent": "<folder node>", "title": "Plan", "markdown": "# Plan\n\nShip **today**."}'
```

**4. Read it as Markdown.** The answer is the Markdown itself, as `text/markdown`, not JSON. Only a signed-in user reads Markdown. A guest on a public link is refused.

```sh
curl -H "$AUTH" "$SITE/api/suite/drive/nodes/<node>/content?format=markdown"
```

**5. Replace the body, or append to it.** `mode` is `replace` or `append`. The user needs edit access to the document.

```sh
curl -X POST $SITE/api/suite/writer/documents/<node>/body -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"markdown": "## Later\n\nOne more thing.", "mode": "append"}'
```

Create and write both answer the document as its row in step 2, shown here with the fields an agent needs, and `rev`, the revision the write made:

```json
{ "data": { "name": "l0e2q0u66a", "title": "Plan", "kind": "document", "parent_node": "84n0kmpagb", "mime": "frappe/writer", "rev": 2 } }
```

**6. Share it with a user.** The user needs manage access, which the one who made the document has. `role` is a number: `10` read, `20` comment, `40` edit, `50` manage, and `0` shuts the user out. On a folder, `30` lets the user add to it.

```sh
curl -X PUT $SITE/api/suite/drive/nodes/<node>/grants/<user's email> -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"role": 40}'
```

```json
{ "data": { "name": "rp8ttmd9hp", "node": "l0e2q0u66a", "principal": "aanya@example.com", "role": 40, "expires_on": null, "has_password": false, "sent_to": null, "person": { "id": "aanya@example.com", "full_name": "Aanya", "user_image": null } } }
```

## What a write does

- It lands as one change by the signed-in user, the same way a tab's edit does. Open tabs get it live.
- The automatic version follows it.
- A read as HTML (`format=html`, or no `format`) shows it at once, for a guest on a public link too. Writer saves the HTML with the document a little later, within about five minutes.
- `append` adds the Markdown after the body. Text someone is typing at that moment stays.
- `replace` removes every block the body had and writes the Markdown. Text typed at that moment into a removed block goes with it. A block added at that moment stays.
- `replace` first keeps a version of the document as it stood, named "Before a replace from Markdown". It stays in the document's versions until someone deletes it. When no version can be kept, as when the Drive is full, the replace is refused. When the versions are only away for a moment, it answers `WriteBusy`.
- `replace` detaches comments: a comment on a removed block is left with no text to point at.
- A heading gets an id of its own, as a typed heading does, so a repeated heading never shares one.
- In a document with tabs, `append` lands at the end of the first tab, and `replace` removes every tab.

## Markdown

- Headings, paragraphs, bold, italic, links, lists, quotes, rules, tables, pictures by address, code and fenced code with a language.
- Name a fenced block's language in full, as `javascript`. A short name such as `js` still colours the code, but the editor's language picker shows it as auto.
- A write keeps all of the Markdown or refuses all of it. Only what shows nothing is left out: an HTML comment, and a link with no text.
- An `append` of Markdown that shows nothing is refused: empty, only spaces and line breaks, or only HTML comments.
- A link or raw HTML the editor can't hold is refused, such as a `javascript:` link or a `<div>`. A `<script>` is never kept: beside other text it is refused, and as the whole Markdown it shows nothing.
- Task lists and strikethrough are not read: `- [ ]` and `~~` stay as typed.
- One call takes up to 128 KB of Markdown, which is 131072 UTF-8 bytes. Write a longer document in parts: create it, then append.

A read writes Markdown as Writer's Download as Markdown does, with a picture as its address. Written back with `replace`, it makes the same document.

- Markdown has no place for colour, underline, highlight, alignment, a mention or a picture's size. A read leaves them out, so a `replace` of a document people have styled loses them. Use `append` there.
- A table's first row reads as its heading row.
- A read gives the document as it stands when the read arrives, typing in a tab included. It saves nothing and holds up no one's typing.
- A new document with nothing in it reads as an empty answer.

## Limits

One user makes up to 30 creates, 30 writes and 60 Markdown reads a minute. A call past that answers `RateLimitExceededError` until the minute ends.

## Refusals

A refusal answers its class and a message:

```json
{ "errors": [{ "type": "MarkdownRefused", "message": "A document can't keep this Markdown: a link or HTML the editor can't hold" }] }
```

| Class | Status | Meaning |
| --- | --- | --- |
| `AuthenticationError` | 401 | The API key or secret is wrong |
| `PermissionError` | 403 | A write has no `Authorization` header |
| `DriveError` | 400 | A field is missing or wrong, such as an empty title, a `mode` other than `replace` or `append`, a `role` that is not one of the numbers, or a `format` Writer does not export, such as `pdf`. The message names it. Nothing was written |
| `DriveNotFound` | 404 | The folder or document does not exist for this user, the item is not a Writer document, or the document was deleted during the write |
| `DriveForbidden` | 403 | The user may not add to the folder or edit the document, the document is in the trash, or a guest asks for Markdown |
| `DriveLocked` | 401 | The item is behind a link password |
| `DriveLinkExpired` | 410 | The link the item is shared by has expired |
| `DriveConflict` | 409 | On create: the title is taken in the folder, and `free_title` names one that is free, or `parent` is not a folder. On a read: the document is not converted yet, the document changed during the read, the HTML is behind the document, or the item is a folder. A read of a document not converted yet asks for its conversion, so read again in a minute. After a change during the read, read again. The HTML is behind while someone types in a tab, or when the converter was busy after a write. That read says `Open the document to refresh its export`. Read again in a moment, or read Markdown, which is always the document as it stands |
| `MarkdownRefused` | 422 | The document can't keep part of the Markdown, the Markdown is over 128 KB, an `append` shows nothing, or the converter ran out of time or failed on the Markdown. Nothing was written. The same Markdown gets the same answer, so change it or write it in smaller parts |
| `WriteRefused` | 409 | The document refuses the write, with the reason a tab's edit gets, such as `unconverted`, `doc_full` or `paused`, or no version could be kept before a replace. The same call gets the same answer until that changes. A write to a document not converted yet asks for its conversion, so write again in a minute |
| `WriteBusy` | 429 | The document is busy, a version is being restored into it or was just restored, the document's versions are away for a moment before a replace, or the converter gave no answer: it was busy or was being updated. The Markdown is not at fault. Send the same call again, after `retry_ms` milliseconds when the answer has it |
| `RateLimitExceededError` | 429 | The user is past a limit above: wait for the minute to end. Or, on a read, the converter gave no answer: it was busy, ran out of time or failed. Read again in a moment |
| `RuntimeError` | 500 | The site can't run the converter: Node or the converter's built bundle is missing. The call is not at fault and nothing was written. Every call that needs the converter gets this answer until the site is fixed, so tell whoever runs the site |

## A document that never converts

A document from before live editing is converted before it can be read as Markdown or written. A read, a write or a tab that opens it asks for the conversion, and it most often lands within a minute. Until then a read answers `DriveConflict` with "This document is not converted yet", and a write answers `WriteRefused` with `unconverted`.

When both still answer that after a few tries a minute apart, stop asking. Either the document can't be converted, and it stays read-only, or the site converts nothing right now. More calls change neither.

- Its HTML still reads. Ask step 4 for `format=html`, and the answer is the body as it was last saved.
- Tell the user. Someone who opens the document in Writer sees which of the two it is, and a System Manager also sees the reason.
- To go on meanwhile, write into a new document, as in step 3, and leave the old one as it is.
