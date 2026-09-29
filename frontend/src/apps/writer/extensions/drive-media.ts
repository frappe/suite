import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { effectScope, watch, type EffectScope, type InjectionKey } from "vue";

import type { MediaHandle } from "@/apps/drive";

/** Opens the Drive media handle for one media node id. */
export type DocumentMedia = (id: string) => MediaHandle;

/** Provided by a surface that has a `DocumentSession`. The old Writer page provides none. */
export const DOCUMENT_MEDIA: InjectionKey<DocumentMedia> = Symbol("writer document media");

const MEDIA_ID = "[A-Za-z0-9_-]{1,140}";
const EMBED_URL = new RegExp(`(?:suite\\.)?writer\\.api\\.embed\\.get\\?id=(${MEDIA_ID})`);
const BARE_ID = new RegExp(`^${MEDIA_ID}$`);
const MEDIA_ELEMENTS = "img, video";

/**
 * The Drive node a stored media reference names, or null. Writer names media
 * by node id in one of two spellings, the same two `suite/writer/drive.py`
 * reads: the embed URL in `src`, or a bare id in `data-node`.
 */
export function mediaNodeId(src: string | null, dataNode?: string | null): string | null {
  if (dataNode && BARE_ID.test(dataNode)) return dataNode;
  return src?.match(EMBED_URL)?.[1] ?? null;
}

/**
 * Show each picture and video through the session's media handle.
 *
 * The document keeps the stored embed URL, so `getHTML()` and the saved body
 * do not change. Only the displayed element gets the handle's signed URL, and
 * it follows the handle when Drive signs a fresh one. Once Drive refuses the
 * picture, the element shows nothing and carries `data-media-state="refused"`.
 * A media node view is a leaf, so ProseMirror ignores the swap.
 */
export const DriveMedia = Extension.create<{ media: DocumentMedia | null }>({
  name: "driveMedia",

  addOptions() {
    return { media: null };
  },

  addProseMirrorPlugins() {
    const media = this.options.media;
    if (!media) return [];
    return [
      new Plugin({
        key: new PluginKey("driveMedia"),
        view: (view) => {
          const display = new MediaDisplay(view.dom, media);
          return { destroy: () => display.destroy() };
        },
      }),
    ];
  },
});

class MediaDisplay {
  private readonly scope: EffectScope = effectScope(true);
  /** Each followed element, with the handle URL this display last put in it. */
  private readonly shown = new WeakMap<Element, { applied: string | null; stop: () => void }>();
  private readonly observer: MutationObserver;

  constructor(private readonly root: HTMLElement, private readonly media: DocumentMedia) {
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") this.follow(record.target as Element);
        else for (const node of record.addedNodes) this.scan(node);
      }
    });
    this.observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "data-node"],
    });
    this.scan(root);
  }

  destroy(): void {
    this.observer.disconnect();
    this.scope.stop();
  }

  private scan(node: Node): void {
    if (!(node instanceof Element)) return;
    if (node.matches(MEDIA_ELEMENTS)) this.follow(node);
    for (const element of node.querySelectorAll(MEDIA_ELEMENTS)) this.follow(element);
  }

  private follow(element: Element): void {
    if (!element.matches(MEDIA_ELEMENTS)) return;
    const src = element.getAttribute("src");
    const current = this.shown.get(element);
    // This change is the display's own swap.
    if (current && current.applied !== null && src === current.applied) return;
    current?.stop();
    this.shown.delete(element);
    const id = mediaNodeId(src, element.getAttribute("data-node"));
    if (!id) return;

    const followed = { applied: null as string | null, stop: () => {} };
    this.shown.set(element, followed);
    this.scope.run(() => {
      const handle = this.media(id);
      followed.stop = watch(
        [handle.src, handle.status],
        ([url, status]) => {
          // A refused picture stops showing, so revoked media is not left on screen.
          const shown = status === "refused" ? "" : url;
          if (shown === null) return;
          if (status === "refused") element.setAttribute("data-media-state", "refused");
          else element.removeAttribute("data-media-state");
          if (element.getAttribute("src") === shown) return;
          followed.applied = shown;
          element.setAttribute("src", shown);
        },
        { immediate: true },
      );
    });
  }
}
