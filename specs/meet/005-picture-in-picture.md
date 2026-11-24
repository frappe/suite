# Meeting picture-in-picture

During an active meeting, participants can keep a small meeting view above other
applications using the browser's picture-in-picture capabilities. This is a
PWA-only enhancement; it does not require a native application.

- Prefer Document Picture-in-Picture where available, with a meeting video view,
  compact Meet toolbar with microphone, camera, and leave
  controls connected to the existing meeting. Reuse Meet toolbar buttons/icons.
- Keep the local participant on top. Mirror their camera or show their avatar
  when it is off. Show one remote participant below, prioritizing active
  speakers once Meet marks them as stable. Keep the current participant during
  brief interruptions and show their avatar when their camera is off. Reuse
  Meet’s name pill with speaking and mute indicators.
- Follow participant pins from the main meeting for the remote camera. During
  an active screen share, show both participant tiles side by side above a
  full-width presentation tile. Prefer a pinned share when several are active.
- Register the browser's automatic picture-in-picture media-session action during
  an active meeting only when Settings → Layout → Automatic picture-in-picture
  is enabled. This browser-local preference persists and defaults to enabled.
  Turning it off closes PiP and invalidates pending/stale automatic requests.
  The browser owns eligibility and permission; switching away
  must not bypass its restrictions by forcing a popup on blur.
- Do not provide a “Pop out meeting” dropdown action. Entry is driven by the
  browser's automatic action where supported. On desktop Firefox with Document
  PiP, Control+Shift+M on macOS or Alt+Shift+M elsewhere opens the window
  from the active meeting. Layout settings
  show the shortcut in place of the automatic-entry preference.
  Where only video picture-in-picture is supported, use a playable meeting video;
  custom controls are available only in Document Picture-in-Picture.
- Keep the existing Participant Connection and audio playback. Opening another
  view must not join the room again, duplicate audio, or stop shared media tracks.
- Closing the floating view must leave the meeting running. Leaving the meeting,
  losing the active connection, or unmounting it must clean up its floating view
  and automatic action handler, including an opening request that resolves late.
- Rejected requests must leave the meeting usable and permit a later browser-triggered retry.
- Browser and OS policy determine placement, automatic activation, and mobile
  availability. A fixed bottom position and identical desktop/phone behavior are
  not requirements.

Verification distinguishes behavioral tests using browser API substitutes from
actual browser PiP execution. Desktop evidence does not establish Android or iOS
app-switching behavior; mobile support claims require testing on those platforms.
