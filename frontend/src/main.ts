import "./index.css";

import { createApp, type App as VueApp } from "vue";
import { createPinia } from "pinia";

import App from "@/App.vue";
import router from "@/router";
import { initSentry } from "@/boot/sentry";
import { clearSlidesUserData } from "@/apps/slides/utils/serviceWorker";
import { initializeCursor } from "@/platform/cursor";
import { useSession } from "@/platform/session";
import { initializeTheme } from "@/platform/theme";
import {
  ready as translationsReady,
  translationPlugin,
} from "@/platform/translation";

initializeCursor();

const app = createApp(App);

// The Slides service worker keeps this user's responses. Every logout path ends
// in the platform session, so the next user never receives them.
useSession().onLogout(clearSlidesUserData);

await Promise.all([
  initSentry(app, router),
  translationsReady,
  initializeTheme(),
  import("@/boot/config").then(({ configureFrappeUI }) => configureFrappeUI()),
]);

app.use(createPinia());
app.use(router);
app.use(translationPlugin);

Promise.all([router.isReady(), installLegacySprite(app)]).then(() => {
  app.mount("#app");
});

async function installLegacySprite(target: VueApp) {
  const { spritePlugin } = await import("frappe-ui/experimental");
  target.use(spritePlugin);
}
