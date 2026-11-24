# Working on a presentation as an agent

How an agent, or any script, finds, builds, edits, reads and shares a Slides presentation with no tab open. A write takes the presentation's slides as JSON, and a read gives the same JSON back.

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

**2. Find a folder or a presentation.** List a folder, or search by title.

```sh
curl -H "$AUTH" $SITE/api/suite/drive/nodes/<folder node>/children
curl -H "$AUTH" "$SITE/api/suite/drive/views/search?term=plan"
```

Both answer rows, shown here with the fields an agent needs. `name` is the node id every other call takes. A folder has `"kind": "folder"`, and a presentation `"kind": "document"` with `"mime": "frappe/slides"`. When `next_cursor` is not null, send it as `cursor` for the next rows.

```json
{ "data": { "rows": [{ "name": "84n0kmpagb", "title": "Plans", "kind": "folder", "parent_node": "84kgnp5ehu", "mime": null }], "next_cursor": null } }
```

**3. Create a presentation** in a folder. The user needs upload access to it. `slides` is a list of one or more slides, in the order they show.

```sh
curl -X POST $SITE/api/suite/slides/presentations -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "parent": "<folder node>",
  "title": "Plan",
  "slides": [
    {
      "background": "#FFFFFF",
      "elements": [
        { "type": "text", "left": 80, "top": 200, "width": 800,
          "content": "<p><span style=\"font-size: 48px\"><strong>Plan for today</strong></span></p>" }
      ]
    }
  ]
}'
```

**4. Read it.** The answer is the JSON a write takes, with every slide's and every element's `id`. A presentation with no slides answers `{"slides": []}`.

```sh
curl -H "$AUTH" $SITE/api/suite/slides/presentations/<node>
```

```json
{ "data": { "slides": [{ "id": "ef848f885", "background": "#FFFFFF", "elements": [
  { "id": "b00910cca", "type": "text", "left": 80, "top": 60, "width": 800, "transform": "none", "transformOrigin": "top left",
    "content": "<p style=\"line-height: 1.5;\"><strong>Plan for today</strong></p>", "zIndex": 1 }
] }] } }
```

**5. Replace the slides, or add some.** The user needs edit access to the presentation. `mode` is `replace` to make the slides these alone, or `append` to add them after the last slide and leave the rest as they are.

```sh
curl -X POST $SITE/api/suite/slides/presentations/<node>/slides -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "mode": "replace",
  "slides": [ { "background": "#FFFFFF", "elements": [ { "type": "text", "left": 80, "top": 80, "content": "<p>Only this</p>" } ] } ]
}'

curl -X POST $SITE/api/suite/slides/presentations/<node>/slides -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "mode": "append",
  "slides": [ { "background": "#FFFFFF", "elements": [ { "type": "text", "left": 80, "top": 80, "content": "<p>One more</p>" } ] } ]
}'
```

Create and write both answer the presentation as its row in step 2, shown here with the fields an agent needs, and `rev`, the revision the write made:

```json
{ "data": { "name": "l0e2q0u66a", "title": "Plan", "kind": "document", "parent_node": "84n0kmpagb", "mime": "frappe/slides", "rev": 2 } }
```

To edit a presentation, read it, change the JSON, and write it back with `replace`. Send back what the read answers, not the forms you first wrote, and keep the ids: Magic Move pairs elements by id, and a connector holds on to an element by it.

A read gives each item as the editor keeps it, so it can differ from what was written:

- `zIndex` counts 1, 2, 3 … in each slide, from the bottom element up.
- A colour is 6 or 8 hex digits, and a named one becomes hex: `red` reads `#ff0000ff`.
- A `circle` shape reads as `oval`.
- Text HTML reads as the editor writes it, with `line-height` on each paragraph.
- Every text, shape and table has `content`. An empty one is `<p style="line-height: 1.5;"></p>`.
- `editorMetadata.lineHeight` reads as `lineHeight`, and an old shadow in pixels reads as the editor's shadow fields.
- A connector end that names an element not on its slide reads as `null`.
- A text has `transform` and `transformOrigin`. Leave them as they are.

**6. Open it in a browser** at `$SITE/d/<node>`.

**7. Share it with a user.** The user needs manage access, which the one who made the presentation has. `role` is a number: `10` read, `20` comment, `40` edit, `50` manage, and `0` shuts the user out. On a folder, `30` lets the user add to it.

```sh
curl -X PUT $SITE/api/suite/drive/nodes/<node>/grants/<user's email> -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"role": 40}'
```

## Slides

A slide is 960 wide and 540 high. `left` and `top` place an element's top left corner from the slide's top left, and `width` and `height` size it, all in those units.

| Field | Value |
| --- | --- |
| `id` | Optional. 1 to 128 letters, digits, `-` or `_`. Leave it out for a new slide, and one is made |
| `background` | A colour, such as `#FFFFFF`, or with opacity `#FFFFFF80` |
| `transition` | `None`, `Fade`, `Slide In` or `Magic Move` |
| `transitionDuration` | Seconds, such as `1` |
| `fadeUnmatchedElements` | `true` or `false`. With Magic Move, fades in what the slide before has no element for |
| `advanceAfter` | Seconds before the slideshow moves on by itself, or leave it out to wait for a click |
| `elements` | A list of elements. One with a higher `zIndex` sits above, and with none, the later in the list sits higher |

A slide holds no other field.

## Elements

Every element has a `type` and a place. It may have an `id`, with the same rule as a slide's, `opacity` from `0` to `100` and `rotation` in degrees. Colours are `#RRGGBB` or `#RRGGBBAA`.

**Text.** `content` is HTML: paragraphs `<p>`, `<strong>`, `<em>`, `<u>`, `<s>`, lists `<ul>` and `<ol>` with `<li>`, line breaks `<br>`, and `<span style="…">` for `color`, `font-size`, `font-family`, `font-weight`, `letter-spacing` and `text-transform`. A paragraph takes `style="text-align: center"`. A text has no `height`: it grows with its lines.

```json
{ "type": "text", "left": 80, "top": 60, "width": 800, "lineHeight": 1.5,
  "content": "<p style=\"text-align: center\"><span style=\"font-size: 36px; color: #1F2937\">Quarterly plan</span></p><ul><li><p>Ship the editor</p></li><li><p>Hire two people</p></li></ul>" }
```

**Shape.** `shapeType` is `rectangle`, `oval`, `diamond`, `triangle`, `pentagon` or `line`. A shape may hold text as `content`, with the same HTML as a text.

```json
{ "id": "box", "type": "shape", "shapeType": "rectangle", "left": 100, "top": 150, "width": 300, "height": 160,
  "fillColor": "#DBEAFE", "strokeColor": "#1D4ED8", "strokeWidth": 2, "strokeStyle": "solid", "borderRadius": 12,
  "content": "<p style=\"text-align: center\">Inside</p>" }
```

**Connector.** A `line` shape whose ends hold on to other elements by id. `anchor` is `left`, `right`, `top`, `bottom` or `auto`. `route` is `straight` or `elbow`. `markerStart` and `markerEnd` are `none`, `arrow`, `triangle`, `circle` or `diamond`.

```json
{ "type": "shape", "shapeType": "line", "left": 400, "top": 230, "width": 200, "height": 0,
  "strokeColor": "#1D4ED8", "strokeWidth": 2, "markerEnd": "arrow",
  "connector": { "route": "straight", "start": { "elementId": "box", "anchor": "right" }, "end": { "elementId": "other", "anchor": "left" } } }
```

**Table.** `content` is a table's HTML in the form the editor saves, or the write is refused. The table's `style` holds its whole width, and `<colgroup>` holds one `<col>` per column with that column's width. Each cell's `colwidth` is its column's width, and holds paragraphs. A `<th>` cell is a heading cell. Copy this form:

```json
{ "type": "table", "left": 80, "top": 120, "width": 400,
  "content": "<table style=\"width: 400px\"><colgroup><col style=\"width: 200px\"><col style=\"width: 200px\"></colgroup><tbody><tr><th colwidth=\"200\"><p>Goal</p></th><th colwidth=\"200\"><p>Owner</p></th></tr><tr><td colwidth=\"200\"><p>Ship</p></td><td colwidth=\"200\"><p>Aanya</p></td></tr></tbody></table>" }
```

**Pictures and videos** are refused for now.

## What a write does

- It lands as one change by the signed-in user, the same way a tab's edit does. Open tabs get it live.
- The automatic version follows it.
- A write keeps all of the slides or refuses all of them, and refuses what the editor would change or leave out.
- `replace` removes every slide and writes the new ones. An edit someone makes at that moment to a removed slide goes with it.
- `append` leaves every slide there is, with what others edit in it, and adds the new slides after the last one.
- `append` with a slide as a read gives it, ids and all, adds a copy of it: the copy and its elements get ids of their own, and Magic Move pairs the copy's elements with the ones they copy.
- `replace` first keeps a version of the presentation as it stood, named "Before a replace from JSON". It stays in the presentation's versions until someone deletes it. When no version can be kept, as when the Drive is full, the replace is refused. When the versions are only away for a moment, it answers `WriteBusy`.
- An id that two slides or elements share, or that another item holds, is given a new one. A connector or Magic Move that named it may then lose its pair, so give every item its own id.
- A combined presentation, one that shows other presentations' slides, takes no write.
- One call takes up to 256 KB of JSON. Build a larger presentation by creating it with its first slides and adding the rest with `append`.

## Limits

One user makes up to 30 creates and writes, and 60 reads, a minute. A call past that answers `RateLimitExceededError` until the minute ends.

## Refusals

A refusal answers its class and a message:

```json
{ "errors": [{ "type": "SlidesRefused", "message": "A presentation can't keep these slides: a text's HTML holds what the editor can't keep" }] }
```

| Class | Status | Meaning |
| --- | --- | --- |
| `AuthenticationError` | 401 | The API key or secret is wrong |
| `PermissionError` | 403 | A write has no `Authorization` header |
| `DriveError` | 400 | A field is missing or wrong, such as an empty title, a `mode` other than `replace` or `append`, or a `role` that is not one of the numbers. The message names it. Nothing was written |
| `DriveNotFound` | 404 | The folder or presentation does not exist for this user, the item is not a presentation, or the presentation was deleted during the write |
| `DriveForbidden` | 403 | The user may not add to the folder or edit the presentation, or the presentation is in the trash |
| `DriveLocked` | 401 | The item is behind a link password |
| `DriveLinkExpired` | 410 | The link the item is shared by has expired |
| `DriveConflict` | 409 | On create: the title is taken in the folder, and `free_title` names one that is free, or `parent` is not a folder |
| `SlidesRefused` | 422 | The slides are not a list of slides, a slide or element holds a field or a value the editor has no place for, an id is not of the form above, a text's HTML holds what the editor can't keep, the JSON is over 256 KB, or the converter ran out of time or failed on it. The message names which. Nothing was written. The same slides get the same answer, so change them |
| `WriteRefused` | 409 | The presentation refuses the write, with the reason a tab's edit gets, such as `unconverted`, `doc_full` or `paused`; or no version could be kept before a replace; or the presentation is a combined one. The same call gets the same answer until that changes. A write to a presentation not converted yet asks for its conversion, so write again in a minute |
| `WriteBusy` | 429 | The presentation is busy, a version is being restored into it or was just restored, the versions are away for a moment before a replace, the presentation changed during a read or an append, a read or an append found it not converted yet, or the converter gave no answer: it was busy or was being updated. The slides are not at fault. Send the same call again, after `retry_ms` milliseconds when the answer has it |
| `RateLimitExceededError` | 429 | The user is past a limit above: wait for the minute to end |
