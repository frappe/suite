# Working on a spreadsheet as an agent

How an agent, or any script, finds, creates, reads, writes and shares a Sheets spreadsheet with no tab open. A spreadsheet holds one or more sheets, the tabs along its bottom. A write types values into a sheet's cells, as a user typing would, and a read gives back what was typed, in the form a write takes.

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

**2. Find a folder or a spreadsheet.** List a folder, or search by title.

```sh
curl -H "$AUTH" $SITE/api/suite/drive/nodes/<folder node>/children
curl -H "$AUTH" "$SITE/api/suite/drive/views/search?term=budget"
```

Both answer rows, shown here with the fields an agent needs. `name` is the node id every other call takes. A folder has `"kind": "folder"`, and a spreadsheet `"kind": "document"` with `"mime": "frappe/sheet"`. When `next_cursor` is not null, send it as `cursor` for the next rows.

```json
{ "data": { "rows": [{ "name": "84n0kmpagb", "title": "Plans", "kind": "folder", "parent_node": "84kgnp5ehu", "mime": null }], "next_cursor": null } }
```

**3. Create a spreadsheet** in a folder. The user needs upload access to it. `title` is up to 140 characters. `sheets` is a list of one or more sheets, in the order their tabs show. Each has a `name` and, when it holds anything, `rows` typed from A1.

```sh
curl -X POST $SITE/api/suite/sheets/spreadsheets -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "parent": "<folder node>",
  "title": "Budget",
  "sheets": [
    { "name": "Costs", "rows": [["Item", "Cost"], ["Rent", 1200], ["Food", 300], ["Total", "=SUM(B2:B3)"]] },
    { "name": "Notes" }
  ]
}'
```

**4. Read it.** The answer is every sheet, in tab order, with what was typed in each cell, from A1 to the sheet's last used row. Each row runs to its last used cell, an empty cell between reads as `""`, and an empty row as `[]`. An empty sheet reads as `"rows": []`.

```sh
curl -H "$AUTH" $SITE/api/suite/sheets/spreadsheets/<node>
```

```json
{ "data": { "sheets": [
  { "name": "Costs", "rows": [["Item", "Cost"], ["Rent", "1200"], ["Food", "300"], ["Total", "=SUM(B2:B3)"]] },
  { "name": "Notes", "rows": [] }
] } }
```

A read gives what was typed, not what a tab shows: a formula reads as the formula, and every value reads as text, such as `"1200"`. Each sheet's `rows` sent back as a cell write from `A1` writes nothing.

To see what a tab shows, read the values. The answer has the same shape, but a formula reads as its result, and a number as its format shows it, such as `"$1,200.00"` or `"15.0%"`. A date or time with no set style reads in US English, such as `"1/15/2026"`, and `NOW` and `TODAY` count in UTC. An error reads as a tab shows it, such as `"#DIV/0!"`, `"#CIRC!"`, `"#NAME?"` or `"#ERROR!"`. A formula that fills more cells, such as `=SEQUENCE(3)`, shows each filled cell at its place, and one with a typed cell in its way reads `"#SPILL!"`. `NOW`, `TODAY`, `RAND` and `RANDBETWEEN` are worked out again on each read, so their result can change. The values are each cell's result, not a picture of the tab: cells in hidden rows and columns and in rows a filter hides are in it, a sparkline reads blank, and a cell under a merge reads its own value, though a tab shows only the merge's top-left cell. Working out the values may take up to 10 seconds and about 1 GB of memory. A spreadsheet whose formulas need more is refused with `SheetsRefused`, and each values read is refused at once until the spreadsheet changes, for up to an hour: read it as typed.

```sh
curl -H "$AUTH" $SITE/api/suite/sheets/spreadsheets/<node>/values
```

```json
{ "data": { "sheets": [
  { "name": "Costs", "rows": [["Item", "Cost"], ["Rent", "1200"], ["Food", "300"], ["Total", "1500"]] },
  { "name": "Notes", "rows": [] }
] } }
```

To write, start from what the typed read gives, never the values: a result written back replaces its formula.

**5. Write a block of cells.** The user needs edit access to the spreadsheet. `sheet` names the sheet, whatever its case. `start` is the cell the block's top left lands on, such as `B2`. Each row of `rows` lands in the next row down. The cells around the block stay as they are.

```sh
curl -X POST $SITE/api/suite/sheets/spreadsheets/<node>/cells -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "sheet": "Costs",
  "start": "C1",
  "rows": [["Paid"], [true], [false], [null]]
}'
```

**6. Add rows** below the sheet's last used row, from column A. On an empty sheet they land from A1.

```sh
curl -X POST $SITE/api/suite/sheets/spreadsheets/<node>/rows -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "sheet": "Notes",
  "rows": [["Rent goes up in March"], ["Food is a guess"]]
}'
```

**7. Add a sheet** after the others. `rows` is optional, typed from A1.

```sh
curl -X POST $SITE/api/suite/sheets/spreadsheets/<node>/sheets -H "$AUTH" -H 'Content-Type: application/json' -d '{
  "name": "Summary",
  "rows": [["Total cost", "=Costs!B4"]]
}'
```

Create and each write answer the spreadsheet as its row in step 2, shown here with the fields an agent needs, and `rev`, the revision the write made:

```json
{ "data": { "name": "l0e2q0u66a", "title": "Budget", "kind": "document", "parent_node": "84n0kmpagb", "mime": "frappe/sheet",
  "content_docname": "q7k3m9d2vt", "rev": 2 } }
```

**8. Open it in a browser** at `$SITE/d/<node>`.

**9. Share it with a user.** The user needs manage access, which the one who made the spreadsheet has. `role` is a number: `10` read, `20` comment, `40` edit, `50` manage, and `0` shuts the user out. On a folder, `30` lets the user add to it.

```sh
curl -X PUT $SITE/api/suite/drive/nodes/<node>/grants/<user's email> -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"role": 40}'
```

**10. Rename it, trash it, or list its versions.** These are Drive's calls, as for any item. Rename and trash need edit access. `{"state": "Active"}` takes it out of the trash.

```sh
curl -X PATCH $SITE/api/suite/drive/nodes/<node> -H "$AUTH" -H 'Content-Type: application/json' -d '{"title": "Budget 2027"}'
curl -X PATCH $SITE/api/suite/drive/nodes/<node> -H "$AUTH" -H 'Content-Type: application/json' -d '{"state": "Trashed"}'
curl -H "$AUTH" $SITE/api/suite/drive/nodes/<node>/versions
```

## Values

Each value in `rows` is typed into its cell as a user would type it:

- Text is typed as it is. Text that starts with `=` is a formula, such as `"=SUM(B2:B3)"` or `"=Costs!B4"`.
- A number is typed as its digits: `1200` and `"1200"` type the same.
- `true` and `false` are typed as `TRUE` and `FALSE`.
- `""` clears the cell.
- `null` leaves the cell as it is. Use it to skip a cell inside a block.

A cell holds up to 32,767 characters.

To change a few cells, write just those cells, with `null` for any between them. Don't read the whole sheet and write it back: a value a tab types between the read and the write would be lost.

## Sheets

- A sheet's name is 1 to 31 characters, with none of `[ ] : * ? / \`.
- Two sheets in a spreadsheet can't share a name, whatever its case.
- A spreadsheet holds up to 200 sheets.
- A sheet runs to row 1,048,576 and column XFD, the 16,384th.

## What a write does

- It lands as one change by the signed-in user, the same way a tab's typing does. Open tabs get it live.
- The automatic version follows it.
- A write keeps all of its cells or refuses all of them.
- A create that answers `WriteBusy` may still leave a blank spreadsheet with that title in the folder. Look for it before creating again.
- A write that changes nothing, such as one sent again after a lost answer, writes nothing and answers the `rev` the spreadsheet is at.
- Adding rows sent again, as after a lost answer, adds the rows again. Read the spreadsheet first to see whether the first one landed.
- Adding a sheet sent again, as after a lost answer, is refused because the name is taken, which can mean the first one landed. Read the spreadsheet first to see.
- A merged cell shows only its top left cell's value. Send `null` for the cells it covers. A value for one of them is refused.
- A cell a tab can't edit, because the sheet is protected, is refused. The message names the cell.
- A write that names a sheet the spreadsheet doesn't have is refused. Add the sheet first, as in step 7.
- One call writes up to 10,000 cells. It counts every cell sent, `null` ones too, and an empty row as one. In a create, it counts every sheet's cells together. Build a larger sheet with several writes.
- A call's body is at most 1 MB.

## Limits

One user makes up to 30 creates, 30 cell writes, 30 row adds and 30 sheet adds a minute, each counted on its own, 60 reads and 10 values reads. A call past that answers `RateLimitExceededError` until the minute ends.

A read gives up to 1,000,000 cells, the empty ones before each sheet's last used cell included. A larger spreadsheet is refused with `SheetsRefused`.

A values read takes a spreadsheet of up to 50,000 cells with a value, and works out its formulas in up to 10 seconds and about 1 GB of memory. A larger or heavier one is refused with `SheetsRefused`: read it as typed.

## Refusals

A refusal answers its class and a message. Read `errors[0].type` and `errors[0].message`, and leave any other key:

```json
{ "errors": [{ "type": "SheetsRefused", "message": "B2 on Costs is under a merged cell: send null for it" }] }
```

A wrong API key answers `AuthenticationError` with no `message`.

| Class | Status | Meaning |
| --- | --- | --- |
| `AuthenticationError` | 401 | The API key or secret is wrong |
| `PermissionError` | 403 | A call has no `Authorization` header |
| `DriveError` | 400 | A field is missing or wrong, such as a `parent`, `title` or `sheet` that is not text, an empty title or one over 140 characters, or a `role` that is not one of the numbers. The message names it. Nothing was written |
| `DriveNotFound` | 404 | The folder or spreadsheet does not exist for this user, the item is not a spreadsheet, or the spreadsheet was deleted during the write |
| `DriveForbidden` | 403 | The user may not add to the folder or edit the spreadsheet, or the spreadsheet is in the trash |
| `DriveLocked` | 401 | The item is behind a link password |
| `DriveLinkExpired` | 410 | The link the item is shared by has expired |
| `DriveConflict` | 409 | On create: the title is taken in the folder, and `free_title` names one that is free, or `parent` is not a folder |
| `SheetsRefused` | 422 | `sheets` or `rows` is not a list as above, a value is not text, a number, `true`, `false` or `null`, a sheet's name breaks a rule under [Sheets](#sheets) or is taken, the spreadsheet would hold over 200 sheets, `sheet` names no sheet the spreadsheet has, `start` is not a cell, a cell's text is over 32,767 characters, a call holds over 10,000 cells or a body over 1 MB, the rows run past the sheet's last row or column, a value lands on a merged or protected cell, a read is over 1,000,000 cells, or a values read is over 50,000 cells with a value or its formulas take over 10 seconds or about 1 GB of memory to work out. The message names which, with the sheet and the cell when one is at fault. Nothing was written. The same call gets the same answer, so change it |
| `WriteRefused` | 409 | The spreadsheet refuses the write, with the reason a tab's edit gets, such as `unconverted`, `doc_full` or `paused`. The same call gets the same answer until that changes. A write to a spreadsheet not converted yet asks for its conversion, so write again in a minute |
| `WriteBusy` | 429 | The spreadsheet is busy, a version is being restored into it or was just restored, the spreadsheet changed during a read, another call adding rows or a sheet was landing on the site, a read found it not converted yet, or the converter gave no answer: it was busy, ran out of time on a write or a typed read, or was being updated. The cells are not at fault. Send the same call again, after `retry_ms` milliseconds when the answer has it |
| `RateLimitExceededError` | 429 | The user is past a limit above: wait for the minute to end |
| `RuntimeError` | 500 | The site can't run the converter: Node or the converter's built bundle is missing. Nothing was written. The call is not at fault and gets the same answer until the site is fixed, so tell whoever runs the site |

## A spreadsheet that never converts

A spreadsheet from before live editing is converted before it can be read or written. A read, a write or a tab that opens it asks for the conversion, and it most often lands within a minute. Until then a read answers `WriteBusy` with "This spreadsheet is not converted yet", and a write answers `WriteRefused` with `unconverted`.

When both still answer that after a few tries a minute apart, stop asking. Either the spreadsheet can't be converted, and it stays read-only, or the site converts nothing right now. More calls change neither.
