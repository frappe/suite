// Keyboard hints in action labels — "Archive Thread (E)", "Move to Trash (Delete)" —
// are noise on touch surfaces. Strips only trailing parentheticals that look like
// shortcuts, so a folder named "Work (old)" is never clipped.
const SHORTCUT_HINT =
	/\s*\((?:(?:Shift|Ctrl|Cmd|Alt|⌘|⇧|⌥)\+)*(?:[A-Z!,.;]|Delete|Backspace|Esc(?:ape)?|Enter|Tab|Space|↑\/K|↓\/J)\)$/
export const stripShortcutHint = (label: string) => label.replace(SHORTCUT_HINT, '')
