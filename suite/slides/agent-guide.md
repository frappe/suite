# Working on a presentation as an agent

How an agent, or any script, finds, builds, edits, reads and shares a Slides presentation with no tab open. A write takes the presentation's slides as JSON, and a read gives the same JSON back.

Make slides from layouts. It is the supported way for now. A layout slide names one of the template's layouts and gives its words, and the slide takes the layout's places, fonts and colours. Raw slide JSON, under [Raw slides](#raw-slides), is there for what the layouts can't make.

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

**3. Create a presentation** in a folder. The user needs upload access to it. `title` is up to 140 characters. `slides` is a list of one or more slides, in the order they show. `template` is optional and names the template the layouts come from, `Light` when it is left out.

```sh
curl -X POST $SITE/api/suite/slides/presentations -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "parent": "<folder node>",
  "title": "Plan",
  "template": "Light",
  "slides": [ { "layout": 2, "texts": ["Plan for today"] } ]
}'
```

**4. Read it.** The answer is the JSON a write takes, with every slide's and every element's `id`. A layout slide reads as the elements it made. A presentation with no slides answers `{"slides": []}`.

```sh
curl -H "$AUTH" $SITE/api/suite/slides/presentations/<node>
```

```json
{ "data": { "slides": [{ "id": "ef848f885", "background": "#FFFFFFFF", "transition": "None", "transitionDuration": "0", "fadeUnmatchedElements": 0, "elements": [
  { "id": "b00910cca", "type": "text", "lineHeight": 1.5, "left": 480.16796875, "top": 270, "width": 794.3359375,
    "transform": "translate(-50%, -50%)", "transformOrigin": "center center", "zIndex": 1,
    "content": "<p style=\"text-align: center; line-height: 1.5;\"><span style=\"color: rgb(0, 0, 0); font-size: 60px; font-family: Inter; letter-spacing: 0px; opacity: 1;\"><strong>Plan for today</strong></span></p>" }
] }] } }
```

**5. Replace the slides, or add some.** The user needs edit access to the presentation. `mode` is `replace` to make the slides these alone, or `append` to add them after the last slide and leave the rest as they are. Both take one or more slides, as create does, so a write can't empty a presentation.

```sh
curl -X POST $SITE/api/suite/slides/presentations/<node>/slides -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "mode": "replace",
  "slides": [ { "layout": 3, "texts": ["Only this", "And what it means"] } ]
}'

curl -X POST $SITE/api/suite/slides/presentations/<node>/slides -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "mode": "append",
  "slides": [ { "layout": 6, "texts": ["Next steps", ["Ship the editor", "Hire two people"]] } ]
}'
```

The layouts come from the presentation's template, or from Light when that template is gone.

Create and write both answer the presentation as its row in step 2, shown here with the fields an agent needs, and `rev`, the revision the write made:

```json
{ "data": { "name": "l0e2q0u66a", "title": "Plan", "kind": "document", "parent_node": "84n0kmpagb", "mime": "frappe/slides",
  "content_docname": "q7k3m9d2vt", "rev": 2 } }
```

To edit a presentation, read it, change the JSON, and write it back: the whole of it with `replace`, or one slide with step 6. Send back what the read answers, not the forms you first wrote, and keep the ids and `refId`s: Magic Move pairs elements by them, and a connector holds on to an element by its id.

A read gives each item as the editor keeps it, so it can differ from what was written. All of it is safe to send back as it is:

- Every element has `zIndex`, which counts 1, 2, 3 … in each slide, from the bottom element up.
- A hex colour reads as sent: `#fff` reads `#fff`. A named element colour becomes hex: `red` reads `#ff0000ff`.
- A colour inside text HTML reads as `rgb(...)`: `color: #1F2937` reads `color: rgb(31, 41, 55)`.
- A `circle` shape reads as `oval`.
- Text HTML reads as the editor writes it: `line-height` on each paragraph, a `lineheight` on each `<li>`, and a `;` after each style. A table cell gains `colspan="1" rowspan="1"`.
- Every text, shape and table has `content`. An empty one is `<p style="line-height: 1.5;"></p>`.
- `editorMetadata.lineHeight` reads as `lineHeight`, and an old shadow in pixels reads as the editor's shadow fields.
- A picture from layout 7 reads with `useTemplateDimensions`, which marks it as the layout's picture frame, and the frame's border and shadow. `borderStyle` is `none`, `solid`, `dashed` or `dotted`, with `borderWidth` and `borderColor`. `shadowColor` and `shadowOpacity`, `0` to `100`, colour the shadow, `shadowBlur` softens it, and `shadowOffset` and `shadowAngle`, in degrees, place it. Any element may take these fields.
- A connector end that names an element not on its slide reads as `null`.
- A text has `transform` and `transformOrigin`. Leave them as they are.
- An element given a new id, because its id was taken, has a `refId` naming the one it was.
- A slide made from a layout reads with its template's own `transition`, `transitionDuration` and `fadeUnmatchedElements`: `"None"`, the string `"0"`, and `0` where `false` would be. A field sent with the slide reads as it was sent.

**6. Change one slide.** Send the whole slide to its own path, in either form. The slide keeps only what is sent: a field or element left out goes, and `"elements": []` empties it. A slide with neither `elements` nor `layout` is refused. `id` is optional, and when sent it must be the path's. The presentation's other slides stay as they are. The answer is the presentation's row with `rev`, as in step 5.

From a layout, the slide gets the layout's elements, with new ids:

```sh
curl -X POST $SITE/api/suite/slides/presentations/<node>/slides/<slide id> -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "slide": { "layout": 2, "texts": ["Plan for tomorrow"] }
}'
```

As raw JSON, send the slide as the read gave it, changed. Its elements keep their ids, so Magic Move and connectors keep their pairs:

```sh
curl -X POST $SITE/api/suite/slides/presentations/<node>/slides/<slide id> -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "slide": { "id": "ef848f885", "background": "#FFFFFFFF", "transition": "None", "transitionDuration": "0", "fadeUnmatchedElements": 0, "elements": [
    { "id": "b00910cca", "type": "text", "lineHeight": 1.5, "left": 480.16796875, "top": 270, "width": 794.3359375,
      "transform": "translate(-50%, -50%)", "transformOrigin": "center center", "zIndex": 1,
      "content": "<p style=\"text-align: center; line-height: 1.5;\"><span style=\"color: rgb(0, 0, 0); font-size: 60px; font-family: Inter; letter-spacing: 0px; opacity: 1;\"><strong>Plan for tomorrow</strong></span></p>" }
  ] }
}'
```

To add an element, give it a `zIndex` above the others, or it may sit under them.

**7. Open it in a browser** at `$SITE/d/<node>`.

**8. Share it with a user.** The user needs manage access, which the one who made the presentation has. `role` is a number: `10` read, `20` comment, `40` edit, `50` manage, and `0` shuts the user out. On a folder, `30` lets the user add to it.

```sh
curl -X PUT $SITE/api/suite/drive/nodes/<node>/grants/<user's email> -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"role": 40}'
```

**9. Rename it, trash it, or list its versions.** These are Drive's calls, as for any item. Rename and trash need edit access. `{"state": "Active"}` takes it out of the trash. A version's `seq` names it, and `label` says what made it, such as "Before a replace from JSON".

```sh
curl -X PATCH $SITE/api/suite/drive/nodes/<node> -H "$AUTH" -H 'Content-Type: application/json' -d '{"title": "Plan v2"}'
curl -X PATCH $SITE/api/suite/drive/nodes/<node> -H "$AUTH" -H 'Content-Type: application/json' -d '{"state": "Trashed"}'
curl -H "$AUTH" $SITE/api/suite/drive/nodes/<node>/versions
```

## Layouts

A layout slide is `layout`, the layout's number, with `texts` and `picture` when the layout holds them. `layout` counts from 1, in the order the template holds its layouts. Light and Dark hold these:

| `layout` | `texts` |
| --- | --- |
| `1` | None: a blank slide |
| `2` | A title, in the middle |
| `3` | A title and a subtitle, in the middle |
| `4` | A title, on the left |
| `5` | A title and a subtitle, on the left |
| `6` | A title, and a list of points |
| `7` | A title on the left half. `picture` fills the right half |

```json
{ "layout": 3, "texts": ["Plan for today", "What we ship this week"] }
```

```json
{ "layout": 6, "texts": ["Goals", ["Ship the editor", "Hire two people", "Plan the launch"]], "transition": "Fade" }
```

```json
{ "layout": 7, "texts": ["Our new office"], "picture": "<picture id>" }
```

- `texts` fill the layout's texts in order. Each is words, or a list of words for several lines. In a list, each one is a point.
- The words are plain text, in the layout's style. HTML in them shows as it is written.
- A text left out, `null` or `""` leaves its element out, so no placeholder words are written.
- `picture` is a picture's id, uploaded as in [Pictures and videos](#pictures-and-videos). With no `picture`, the layout's picture frame is left out.
- A layout slide takes a slide's fields, such as `background` or `transition`, and they win over the layout's own.
- A call can mix layout slides and raw slides.
- A layout slide holds no `elements`. To change its elements, read it and write it back as raw JSON.

Another template's layouts are its slides in order. List the templates the user can use, then read one by its `node` as in step 4:

```sh
curl -H "$AUTH" $SITE/api/method/suite.slides.doctype.presentation.presentation.get_templates
```

It answers in Frappe's shape, under `message`, shown here with the fields an agent needs. Take `title` for create's `template`, and `node` for the read. Ignore `name`, `layouts` and the other keys.

```json
{ "message": [{ "title": "Light", "node": "84q7a1b2c3" }, { "title": "Dark", "node": "84q7a1b2c4" }] }
```

A template's read gives layout 7's picture frame a placeholder path as `src`, and a write refuses that path. So don't send a template's slide back as it is: use the layout form.

A template is a presentation too. A user who can edit it can write to it as above, and a slide made from a layout after that takes the layout as it is then.

A read doesn't name the presentation's template. A presentation takes its layouts from the `template` it was created on, or from the one picked when it was made in a browser.

## Pictures and videos

A picture or video is named by its id. Upload the file to the presentation first: create the presentation, take `content_docname` from the answer, and send the file. Send `content_docname`, not the presentation's node. A node answers "That presentation is not in Drive yet".

```sh
curl -X POST $SITE/api/method/suite.slides.api.media.add -H "$AUTH" -F docname=<content_docname> -F file=@chart.png
```

```json
{ "message": { "file_url": "84r2c1b0dd", "file_name": "chart.webp" } }
```

- `file_url` is the id.
- It takes `image/*` and `video/*` files, up to 25 MB, unless the site config sets another `max_file_size`.
- A PNG or JPEG is stored as WebP.
- For a picture on a slide that isn't the last one, create the presentation with that slide as layout 7 and no `picture`. Upload the picture, then change that slide as in step 6 with `layout: 7`, its `texts` and the `picture`. The slide keeps its place.
- A refusal here has Frappe's shape, not the one under [Refusals](#refusals): an `exception` to read, with no `errors`. An unknown `docname`, a missing file and a file that isn't a picture or video, by its type or by its bytes, answer status 417. A full Drive answers 413 with `DriveOverQuota` in the `exception`.
- A file over the size limit is refused before it reaches Suite: status 413 and an HTML page, with no `exception`.

A picture or video another presentation holds may be named too, when the user can read it: the write copies it into this presentation, and a read names the copy. A link, or a file kept elsewhere in Drive, is refused: upload it to the presentation.

## Raw slides

Raw JSON gives every element's place and style. Use it for what the layouts can't make, and to change a slide a read gave back.

### Slides

A slide is 960 wide and 540 high. `left` and `top` place an element's top left corner from the slide's top left, and `width` and `height` size it, all in those units. When a text has `"transform": "translate(-50%, -50%)"`, as a layout's texts do, its `left` and `top` are its centre instead.

| Field | Value |
| --- | --- |
| `id` | Optional. 1 to 128 letters, digits, `-` or `_`. Leave it out for a new slide, and one is made |
| `background` | A hex colour: `#RGB` or `#RRGGBB`, or with opacity `#RGBA` or `#RRGGBBAA`, such as `#FFFFFF80` |
| `transition` | `None`, `Fade`, `Slide In` or `Magic Move` |
| `transitionDuration` | Seconds, such as `1` |
| `fadeUnmatchedElements` | `true` or `false`. With Magic Move, fades in what the slide before has no element for |
| `advanceAfter` | Seconds before the slideshow moves on by itself, or leave it out to wait for a click |
| `elements` | A list of elements. One with a higher `zIndex` sits above. When two have the same `zIndex`, or have none, which counts as `1`, the later in the list sits higher |

A raw slide holds no other field.

### Elements

Every element has a `type` and a place. It may have:

- `id`, with the same rule as a slide's.
- `refId`, which Magic Move pairs it by. An element moves into the one on the next slide with the same `refId`, or with the same `id` when it has no `refId`. Set the same `refId` on two elements to pair them. A table never pairs.
- `opacity` from `0` to `100`, and `rotation` in degrees.

Colours are `#RRGGBB` or `#RRGGBBAA`.

**Text.** `lineHeight` is the space between lines, such as `1.5`. `content` is HTML: paragraphs `<p>`, `<strong>`, `<em>`, `<u>`, `<s>`, lists `<ul>` and `<ol>` with `<li>`, line breaks `<br>`, links `<a href="https://…">`, and `<span style="…">` for `color`, `font-size`, `font-family`, `font-weight`, `letter-spacing` and `text-transform`. A paragraph takes `style="text-align: center"`. A text has no `height`: it grows with its lines.

A link's `href` starts with `http:`, `https:`, `ftp:`, `ftps:`, `mailto:`, `tel:`, `callto:`, `sms:`, `cid:` or `xmpp:`, or has no scheme, such as `/plans` or `#goals`. A link with an empty `href`, or any other scheme, such as `javascript:` or `data:`, is refused, and so is an attribute such as `onclick`. An `<a>` with no `href` is not refused: the link is dropped and its words are kept. A read gives each link `target="_blank"` and `rel="noopener noreferrer nofollow"`.

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

**Table.** `content` is a table's HTML. A plain table is written in the form the editor saves, with its columns sharing the element's whole `width`, the first ones a pixel wider when it doesn't divide evenly. So a plain table without a `width` that is a whole number of 1 or more is refused. Plain means bare `<table>`, `<thead>`, `<tbody>` and `<tfoot>` tags around bare `<tr>` rows, each holding `<th>` and `<td>` cells with no `colspan`, `rowspan` or `colwidth`. Any other table is kept as sent or refused. In the editor's form, the table's `style` holds its whole width, the sum of its columns' widths, and `<colgroup>` holds one `<col>` per column with that column's width. Each cell's `colwidth` is its column's width, and holds paragraphs. A table with no rows, a row of no cells, or rows that hold different numbers of cells is refused. A `<th>` cell is a heading cell. Copy this form:

```json
{ "type": "table", "left": 80, "top": 120, "width": 400,
  "content": "<table style=\"width: 400px\"><colgroup><col style=\"width: 200px\"><col style=\"width: 200px\"></colgroup><tbody><tr><th colwidth=\"200\"><p>Goal</p></th><th colwidth=\"200\"><p>Owner</p></th></tr><tr><td colwidth=\"200\"><p>Ship</p></td><td colwidth=\"200\"><p>Aanya</p></td></tr></tbody></table>" }
```

**Picture.** `src` is the id of a picture, uploaded as in [Pictures and videos](#pictures-and-videos).

```json
{ "type": "image", "src": "<picture id>", "left": 80, "top": 120, "width": 400, "height": 300, "borderRadius": 8 }
```

**Video.** `src` is the id of a video, uploaded the same way. `poster`, the picture shown before it plays, is optional and uploaded the same way too.

```json
{ "type": "video", "src": "<video id>", "poster": "<picture id>", "left": 80, "top": 120, "width": 640, "height": 360,
  "autoplay": false, "loop": false }
```

## What a write does

- It lands as one change by the signed-in user, the same way a tab's edit does. Open tabs get it live.
- The automatic version follows it.
- A write keeps all of the slides or refuses all of them. It refuses what the editor would change or leave out.
- A write checks the names of fields, each element's `type`, the ids, the pictures, the background and the HTML. It doesn't check the kind of every other value: `"left": true`, or `"width": "x"` on anything but a plain table, is kept as sent. So send each value in the kind a read gives it, since a wrong kind may be kept and draw wrong.
- `replace` removes every slide and writes the new ones. An edit someone makes at that moment to a removed slide goes with it.
- `append` leaves every slide there is, with what others edit in it, and adds the new slides after the last one. An `append` sent again, as after a lost answer, adds its slides again. Read the presentation first to see whether the first one landed.
- An empty slide, `{}`, is refused. Send `{"elements": []}` for a blank slide.
- `append` with a slide as a read gives it, ids and all, adds a copy of it: the copy and its elements get ids of their own, and Magic Move pairs the copy's elements with the ones they copy.
- A one-slide write makes that slide hold what it sends alone: a field or element it leaves out goes. The slide keeps its place, and an element keeps its id when the slide already holds it. It keeps no version.
- `replace` first keeps a version of the presentation as it stood, named "Before a replace from JSON". It stays in the presentation's versions until someone deletes it. When no version can be kept, as when the Drive is full, the replace is refused. When the versions are only away for a moment, it answers `WriteBusy`.
- An id that two slides or elements share, or that another item in this presentation holds, is given a new one. A connector that named it may then lose its end, so give every item its own id. A renamed element keeps its Magic Move pair through its `refId`.
- A combined presentation, one that shows other presentations' slides, takes no write.
- One call takes up to 256 KB of JSON. Build a larger presentation by creating it with its first slides and adding the rest with `append`.

## Limits

One user makes up to 30 creates, 30 slides writes and 30 one-slide writes a minute, each counted on its own, and 60 reads. A call past that answers `RateLimitExceededError` until the minute ends. Uploads don't count toward these.

## Refusals

A refusal answers its class and a message. Read `errors[0].type` and `errors[0].message`, and leave any other key:

```json
{ "errors": [{ "type": "SlidesRefused", "message": "A presentation can't keep these slides: a text's HTML holds what the editor can't keep" }] }
```

A wrong API key answers `AuthenticationError` with no `message`.

| Class | Status | Meaning |
| --- | --- | --- |
| `AuthenticationError` | 401 | The API key or secret is wrong |
| `PermissionError` | 403 | A call has no `Authorization` header |
| `DriveError` | 400 | A field is missing or wrong, such as an empty title or one over 140 characters, a `mode` other than `replace` or `append`, or a `role` that is not one of the numbers. The message names it. Nothing was written |
| `DriveNotFound` | 404 | The folder, presentation or slide does not exist for this user, the item is not a presentation, or the presentation was deleted during the write |
| `DriveForbidden` | 403 | The user may not add to the folder or edit the presentation, or the presentation is in the trash |
| `DriveLocked` | 401 | The item is behind a link password |
| `DriveLinkExpired` | 410 | The link the item is shared by has expired |
| `DriveOverQuota` | 413 | The Drive has no room for a picture the create or write copies under the presentation. Slides with no pictures don't get this. Nothing was made or written. Upload less, or free some space |
| `DriveStorageUnmeasured` | 413 | The site hasn't measured its storage yet, so a picture the create or write copies can't be checked against the room. Nothing was made or written. Send the same call again later |
| `DriveConflict` | 409 | On create: the title is taken in the folder, and `free_title` names one that is free, or `parent` is not a folder |
| `SlidesRefused` | 422 | The slides are not a list of slides, a slide or element holds a field or a `type` the editor has no place for, a background is not a hex colour, an id is not of the form above, a one-slide write names an `id` other than its path's or sends neither `elements` nor `layout`, a layout slide names a layout the template doesn't hold, more texts than it holds, a picture it has no frame for, or elements too, `template` names no template the user can use, there is no template to take a layout from, a slide is empty, a text's HTML holds what the editor can't keep, a link the editor drops or an attribute such as `onclick`, a table holds no rows, a table's row holds no cells or its rows hold different numbers of cells, a plain table's `width` is not a whole number of 1 or more, a picture is named by a link or names a file that isn't there, that the user can't read or that no presentation holds, the JSON is over 256 KB, or the converter ran out of time or failed on it. The message names which, with the slide, the element when one is at fault, and the field or tag when it can. Nothing was written. The same slides get the same answer, so change them |
| `WriteRefused` | 409 | The presentation refuses the write, with the reason a tab's edit gets, such as `unconverted`, `doc_full` or `paused`; or no version could be kept before a replace; or the presentation is a combined one. The same call gets the same answer until that changes. A write to a presentation not converted yet asks for its conversion, so write again in a minute |
| `WriteBusy` | 429 | The presentation is busy, a version is being restored into it or was just restored, the versions are away for a moment before a replace, the presentation changed during a read or an append, a read or an append found it not converted yet, a layout's template is not converted yet, or the converter gave no answer: it was busy or was being updated. The slides are not at fault. Send the same call again, after `retry_ms` milliseconds when the answer has it |
| `RateLimitExceededError` | 429 | The user is past a limit above: wait for the minute to end |
