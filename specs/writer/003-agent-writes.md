# Writing a document from Markdown

Status: accepted

How an agent, or any script, writes a Writer document with no tab open. Two calls: create a document, and replace or append its body. Both take Markdown.

## The calls

Sign in as the user the agent works for, here with an API key. History and versions name that user.

Create a document in a folder. `parent` is the folder's Drive node id. With the folder open in Drive, it is in the address bar: `/drive/f/<node>/…`. The user needs upload access to it.

```sh
curl -X POST https://suite.example.com/api/suite/writer/documents \
  -H 'Authorization: token <api_key>:<api_secret>' \
  -H 'Content-Type: application/json' \
  -d '{"parent": "<folder node>", "title": "Plan", "markdown": "# Plan\n\nShip **today**."}'
```

Replace a document's body, or append to it. `mode` is `replace` or `append`. The user needs edit access to the document.

```sh
curl -X POST https://suite.example.com/api/suite/writer/documents/<node>/body \
  -H 'Authorization: token <api_key>:<api_secret>' \
  -H 'Content-Type: application/json' \
  -d '{"markdown": "## Later\n\nOne more thing.", "mode": "append"}'
```

Both answer the document's Drive node id and the revision the write made:

```json
{ "data": { "node": "l0e2q0u66a", "rev": 2 } }
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
- Raw HTML the editor can't hold is refused, such as a `<div>`.
- Task lists and strikethrough are not read: `- [ ]` and `~~` stay as typed.
- One call takes up to 128 KB of Markdown, which is 131072 UTF-8 bytes. Write a longer document in parts: create it, then append.

## Refusals

A refusal answers its class and a message:

```json
{ "errors": [{ "type": "MarkdownRefused", "message": "A document can't keep this Markdown: raw HTML the editor can't hold" }] }
```

| Class | Status | Meaning |
| --- | --- | --- |
| `AuthenticationError` | 401 | The API key or secret is wrong |
| `PermissionError` | 403 | The call has no `Authorization` header |
| `DriveError` | 400 | A field is missing or wrong, such as an empty title or a `mode` other than `replace` or `append`. The message names it. Nothing was written |
| `DriveNotFound` | 404 | The folder or document does not exist for this user, or the item is not a Writer document |
| `DriveForbidden` | 403 | The user may not add to the folder or edit the document, or the document is in the trash |
| `DriveLocked` | 401 | The item is behind a link password |
| `DriveLinkExpired` | 410 | The link the item is shared by has expired |
| `DriveConflict` | 409 | The title is taken in the folder, and `free_title` names one that is free. Or `parent` is not a folder, and the answer has no `free_title`. Nothing was created |
| `MarkdownRefused` | 422 | The document can't keep part of the Markdown, or the Markdown is over 128 KB. Nothing was written |
| `WriteRefused` | 409 | The document refuses the write, with the reason a tab's edit gets, such as `unconverted` or `doc_full`. The same call gets the same answer until that changes |
| `WriteBusy` | 429 | The converter or the document is busy. Send the same call again, after `retry_ms` milliseconds when the answer has it |
