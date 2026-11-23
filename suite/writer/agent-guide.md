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
- The automatic version and the readable copy follow it.
- `append` adds the Markdown after the body. Text someone is typing at that moment stays.
- `replace` removes every block the body had and writes the Markdown. Text typed at that moment into a removed block goes with it. A block added at that moment stays.
- A heading gets an id of its own, as a typed heading does, so a repeated heading never shares one.
- In a document with tabs, `append` lands at the end of the first tab, and `replace` removes every tab.

## Markdown

- Headings, paragraphs, bold, italic, links, lists, quotes, rules, tables, pictures by address, code and fenced code with a language.
- Name a fenced block's language in full, as `javascript`. A short name such as `js` still colours the code, but the editor's language picker shows it as auto.
- A write keeps all of the Markdown or refuses all of it. Only what shows nothing is left out: an HTML comment, and a link with no text.
- A link or raw HTML the editor can't hold is refused, such as a `javascript:` link or a `<div>`. A `<script>` is never kept: beside other text it is refused, and as the whole Markdown it leaves an empty paragraph.
- Task lists and strikethrough are not read: `- [ ]` and `~~` stay as typed.
- One call takes up to 128 KB of Markdown, which is 131072 UTF-8 bytes. Write a longer document in parts: create it, then append.

A read writes Markdown as Writer's Download as Markdown does, with a picture as its address. Written back with `replace`, it makes the same document.

- Markdown has no place for colour, underline, highlight, alignment, a mention or a picture's size. A read leaves them out, so a `replace` of a document people have styled loses them. Use `append` there.
- A table's first row reads as its heading row.
- A read gives the document as it stands, typing in a tab included. If typing lands in the same moment, it answers `DriveConflict`. Read again.

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
| `DriveConflict` | 409 | On create: the title is taken in the folder, and `free_title` names one that is free, or `parent` is not a folder. On a read: typing landed in the same moment, or the item is a folder |
| `MarkdownRefused` | 422 | The document can't keep part of the Markdown, or the Markdown is over 128 KB. Nothing was written |
| `WriteRefused` | 409 | The document refuses the write, with the reason a tab's edit gets, such as `unconverted` or `doc_full`. The same call gets the same answer until that changes |
| `WriteBusy` | 429 | The document is busy, or the converter gave no answer: it was busy, ran out of time, failed, or was being updated. The Markdown is not at fault. Send the same call again, after `retry_ms` milliseconds when the answer has it |
| `RateLimitExceededError` | 429 | The converter gave no answer on a read, as for `WriteBusy`. Read again in a moment |
