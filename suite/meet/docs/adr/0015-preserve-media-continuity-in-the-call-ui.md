# Preserve media continuity in the call UI

Meet keeps the video ref callback stable for each participant and keeps hidden tiles mounted. A stable callback avoids detaching and reattaching video on layout updates. Retaining tiles lets the grid animate across visibility changes. Pinned screen shares overlay the main panel and do not consume a tile in the strip.

Visible tiles show their own reactions in grid mode, so the floating layer handles reactions from hidden participants. In the sidebar layout, the floating layer can show a reaction from any participant because the main panel may not show that participant's tile.

The audio meter uses an existing media stream when one is supplied. Device settings can open the selected microphone for its own preview. The meter measures RMS across a time-domain window to smooth out peaks, then boosts quiet signals with a mostly square-root curve and smooths each bar across frames. This keeps soft speech visible without making the bar jump at every peak.
