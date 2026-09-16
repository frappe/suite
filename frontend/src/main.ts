import "./index.css";

import { createApp, type App as VueApp } from "vue";
import { createPinia } from "pinia";

import App from "@/App.vue";
import router from "@/router";
import { initSentry } from "@/boot/sentry";
import { initializeTheme } from "@/platform/theme";
import {
  ready as translationsReady,
  translationPlugin,
} from "@/platform/translation";

const app = createApp(App);

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
