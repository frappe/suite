import { createApp, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";

import UnavailableSurface from "@/shell/UnavailableSurface.vue";

let cleanup: (() => void) | undefined;

afterEach(() => cleanup?.());

describe("UnavailableSurface", () => {
  it("renders a product-neutral reason and next step without navigation", () => {
    history.replaceState({}, "", "/mail/inbox");
    const root = document.createElement("div");
    document.body.appendChild(root);
    const app = createApp({
      setup: () => () =>
        h(UnavailableSurface, {
          reason: "This area needs a configured account.",
          nextStep: "Ask an administrator to configure it.",
        }),
    });
    app.mount(root);
    cleanup = () => {
      app.unmount();
      root.remove();
    };

    expect(root.textContent).toContain("This area needs a configured account.");
    expect(root.textContent).toContain("Ask an administrator to configure it.");
    expect(location.pathname).toBe("/mail/inbox");
  });
});
