import { reactive, ref } from 'vue'

/** Runs `run`, handing a refusal to `refused` on its way out. */
async function attempt(run: () => unknown, refused: (refusal: Error) => void) {
  try {
    return await run()
  } catch (cause) {
    if (cause instanceof Error) {
      refused(cause)
    }

    throw cause
  }
}

/**
 * Stands in for `useMutation` in a form's test. As the real one, it keeps why the last run was
 * refused until the next run or a reset, and hands the refusal to `toast` unless the form asked
 * for silence.
 */
export function fakeMutation(
  run: (input: unknown) => unknown,
  toast: (message: string) => void,
  options?: { silent?: boolean },
) {
  const error = ref<Error | null>(null)
  function keep(refusal: Error) {
    error.value = refusal
    if (!options?.silent) {
      toast(refusal.message)
    }
  }

  return reactive({
    isPending: false,
    error,
    reset: () => {
      error.value = null
    },
    run: (input: unknown) => {
      error.value = null

      return attempt(() => run(input), keep)
    },
  })
}
