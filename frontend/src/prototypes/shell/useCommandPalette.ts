// PROTOTYPE — remove. Module-scoped open state so any page header can raise the
// palette without threading a prop through the shell.
import { ref } from 'vue'

export const commandPaletteOpen = ref(false)
