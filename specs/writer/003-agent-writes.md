# Writing a document from Markdown

Status: accepted

How an agent, or any script, writes a Writer document with no tab open. Two calls: create a document, and replace or append its body. Both take Markdown.

## The calls

Sign in as the user the agent works for, here with an API key. History and versions name that user.

Create a document in a folder. `parent` is the folder's Drive node id. The user needs upload access to it.

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

## Markdown

- Headings, paragraphs, bold, italic, links, lists, quotes, rules, tables, pictures by address, code and fenced code with a language.
- A write keeps all of the Markdown or refuses all of it. Only what shows nothing is left out: an HTML comment, and a link with no text.
- Raw HTML the editor can't hold is refused, such as a `<div>`.
- Task lists and strikethrough are not read: `- [ ]` and `~~` stay as typed.

## Refusals

A refusal answers its class and a message:

```json
{ "errors": [{ "type": "MarkdownRefused", "message": "A document can't keep this Markdown: empty-link" }] }
```

| Class | Status | Meaning |
| --- | --- | --- |
| `DriveNotFound` | 404 | The folder or document does not exist for this user |
| `DriveForbidden` | 403 | The user may not add to the folder or edit the document, or the document is in the trash |
| `DriveLocked` | 401 | The item is behind a link password |
| `MarkdownRefused` | 422 | The document can't keep part of the Markdown. Nothing was written |
| `WriteRefused` | 409 | The document refuses the write, with the reason a tab's edit gets, such as `unconverted` |
| `WriteBusy` | 429 | The converter or the document is busy. Send the same call again in a moment |

A `mode` other than `replace` or `append` is refused before anything is written.
