# Sheets: editing together

Status: proposed

Scope: what happens when several people edit the same sheet at once: how their changes are ordered, what each person sees, how access is checked, and who saves. It builds on the commands in [001](001-calculation-core.md) and the log in [002](002-saving.md).

The design follows [ADR 0001](../../docs/adr/0001-sheets-ironcalc-calculation-core.md): every client applies the same commands in the same order.

Code: `suite/sheets/collab-server/` (the server, with `hooks.js`, `access-recheck.js`, `connection-token.js` on `forge/drive-layer`), `frontend/src/apps/sheets/collab/` (the client side), `frontend/src/apps/sheets/collab/awareness.js` (presence).

## Today (on `forge/drive-layer`)

The collab server is Hocuspocus with a Yjs document per sheet (`Sheet Collab State`). It checks Drive access when a user connects and re-checks during the session; READ and COMMENT users are read only. The Yjs binding syncs only single-cell typing. Paste, fill, insert and delete rows do not reach other people.

## Behaviour

### One order for every change

The collab server is the **sequencer**. It runs IronCalc too (`@ironcalc/nodejs`) and keeps its own copy of the workbook.

1. A client sends `submit { commands }`.
2. The server validates each command with the same `commands.ts` and applies it to its copy.
3. It gives each accepted command the next `seq` and broadcasts `commands { seq, command }` to everyone on the sheet, the sender included.
4. Each client applies commands strictly in `seq` order.

### What each person sees

| Event | On the sender's screen | On everyone else's screen |
| --- | --- | --- |
| Types in a cell | At once (applied locally on dispatch) | When the broadcast arrives |
| Paste, fill, insert or delete rows | At once | When the broadcast arrives, as one change |
| Own command comes back in the broadcast | Nothing: it is a confirmation, not applied again | — |
| Server rejects a command | The client applies the stored inverse; the change disappears and a message says why | Nothing |
| Two people edit the same cell | The later `seq` wins, for everyone | Same |

Presence (who is here, their selection, their cursor) stays on `collab/awareness.js` and travels on the same connection.

### Joining and reconnecting

1. On join, the client loads the snapshot and the ops after it ([002](002-saving.md)), then receives live commands from the server.
2. If the connection drops, typing continues locally. Commands wait, unconfirmed.
3. On reconnect, the client catches up from its last confirmed `seq`, then resends its unconfirmed commands. Commands that no longer apply are rejected and rolled back as above.

### Who saves

While a sheet has a collab session, the server writes `Sheet Op Log` and the snapshot. Browsers do not call `save_sheet` for that sheet. The server flushes the log every 2 seconds or every 100 commands, whichever is first.

### Access

- Drive decides access (`Drive Grant`). The existing `onAuthenticate` and `access-recheck.js` stay: READ and COMMENT users receive broadcasts, but their `submit` is refused.
- Access removed mid-session: the connection becomes read only on the next message, as today.
- The server validates every command, so a modified client cannot send a malformed change.

### Feature settings

Conditional formats, validation, charts, filters and comment anchors are last-writer-wins per feature in this version. If two people change the same chart's settings at once, one change wins.

## Open question

Does the sequencer run **inside** the existing Hocuspocus server (custom messages, reusing its auth and re-check hooks) or **replace** Yjs in that server? Inside reuses the tested access layer; replacing gives a simpler protocol and removes `Sheet Collab State`.

## Constraints

- The server must be able to load `@ironcalc/nodejs`, a native module, wherever the collab server is deployed.
- Client and server run the same pinned IronCalc version, or they would calculate differently.
- A test: N simulated users send random commands; every client and the server end with identical workbook bytes.
