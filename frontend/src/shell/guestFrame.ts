import type { InjectionKey } from "vue";

/**
 * What the guest frame offers the page inside it (spec §10.3, §10.8).
 *
 * A page that a visitor without a session cannot read asks the frame for the
 * Sign-in screen. The screen never says whether the item exists. The frame
 * shows the page again on the next navigation.
 */
export interface GuestFrame {
  requireSignIn(): void;
}

export const GUEST_FRAME_KEY: InjectionKey<GuestFrame> = Symbol("guest-frame");

/**
 * `/login` returns to the same item inside the shell (spec §10.9).
 *
 * The fragment never goes along: it can hold a share-link token, and the
 * redirect would put it in a query string, server logs and referrers.
 */
export function signInUrl(fullPath: string): string {
  const [pathAndQuery = ""] = fullPath.split("#");
  return `/login?redirect-to=${encodeURIComponent(pathAndQuery)}`;
}
