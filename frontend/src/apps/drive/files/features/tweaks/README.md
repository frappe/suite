# Drive tweaks

Evaluation scaffolding for the Drive UI/UX branch. Each UI change sits behind a tweak, so Faris can switch it on and off in the running app and decide which changes to keep. A kept tweak later loses its switch; a rejected one loses its new code. Grep for `isTweakOn(`, `useTweak(` and the tweak id to find every gate.

The store lives in `@/platform/tweaks`, so platform code such as `platform/server-state` can read a tweak without importing Drive. The list of tweaks lives in `registry.ts` here and adds its ids to `TweakId`, so a misspelt id is a type error everywhere. The panel (`TweakPanel.vue`) opens from "Tweaks" in the Drive sidebar, or from the flask button on a phone and on document routes. Every tweak starts on, and each browser keeps its own switches under one localStorage key.

**The rule:** when a tweak is off, the old behaviour must be exactly what it was before your change. Keep both paths complete; do not change the old path while you add the new one.

In a component:

```ts
import { useTweak } from '@/platform/tweaks'

const isNewFolderMenu = useTweak('t3-folder-menu') // ComputedRef<boolean>
```

In plain TypeScript, in Drive or in platform code. The call is reactive inside a computed, a watcher or a render:

```ts
import { isTweakOn } from '@/platform/tweaks'

if (isTweakOn('t22')) coalesceChanges()
```

To split an item into separable parts, replace its line in `registry.ts` with one line per part, ids `t<item>-<part>`, each with the same `item` and `group`. To show a switch in the panel, set `ready: true` on its line once the change works both ways.
