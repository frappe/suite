# Sheets glossary

Terms used across the Sheets codebase.

- **Workbook**: The whole document. It holds multiple sheets, plus styles,
  defined names, and view state.
- **Command**: One semantic, engine-independent JSON record of a user action.
  It is the only way state changes.
- **Command log**: The server-sequenced, append-only list of commands. It is
  the source of truth for history and sync.
- **Engine**: The calculation core that applies commands and evaluates
  formulas. Currently IronCalc.
- **Adapter**: The layer that translates commands into engine calls and
  exposes read access, through `createWorkbook()`.
- **Snapshot**: A serialized engine state at a sequence number. It is a
  replay shortcut, never the source of truth.
- **Viewport**: The visible cell rectangle the renderer reads each frame.
- **Feature layer**: An in-house module, such as pivots, charts, filter and
  sort, validation, or comments. It reads through the adapter and emits
  commands.
- **View model**: Selection, column widths, row heights, freeze, and zoom. It
  is serializable and owned outside the renderer.
