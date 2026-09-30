import { createApp, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";

import CommentAuthor from "./CommentAuthor.vue";

const mounted: Array<() => void> = [];

afterEach(() => mounted.splice(0).forEach((unmount) => unmount()));

function render(author: string | null, authorName: string | null): HTMLElement {
  const root = document.createElement("div");
  const app = createApp({ render: () => h(CommentAuthor, { author, authorName }, () => "Someone") });
  app.mount(root);
  mounted.push(() => app.unmount());
  return root;
}

const RLO = "\u202E";

describe("a comment's author", () => {
  it("shows a guest's name and the Guest marker as separate parts", () => {
    const root = render("Guest", "Ravi (Acme)");

    expect(root.textContent).toBe("Ravi (Acme) · Guest");
    expect(root.querySelector('[data-part="name"]')?.textContent).toBe("Ravi (Acme)");
    expect(root.querySelector('[data-part="marker"]')?.textContent).toBe("· Guest");
  });

  it("isolates a name with a bidi override, so the marker stays outside it", () => {
    const root = render("Guest", `${RLO}evaR`);
    const name = root.querySelector('[data-part="name"]')!;
    const marker = root.querySelector('[data-part="marker"]')!;

    expect([name.tagName, name.getAttribute("dir"), name.textContent]).toEqual(["BDI", "auto", `${RLO}evaR`]);
    expect(name.contains(marker)).toBe(false);
    expect(marker.textContent).toBe("· Guest");
  });

  it("shows plain Guest without a name, and the product's own label for a user", () => {
    expect(render("Guest", null).textContent).toBe("Guest");
    expect(render("ann@example.com", null).textContent).toBe("Someone");
  });
});
