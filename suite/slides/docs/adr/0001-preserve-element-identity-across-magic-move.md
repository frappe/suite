# Preserve element identity across Magic Move

Magic Move reuses a rendered node across slides when the elements share a transition key. Slides uses a shared `refId` as that key so adjacent versions of an element can tween even when their individual IDs differ.

Text pairing compares the rendered text of corresponding top-level blocks. It ignores markup, styling, and zero-width spaces. Editing an empty block can insert a zero-width placeholder, so retaining the placeholder would make visually identical blocks fail to pair. Preserving block boundaries keeps the comparison sensitive to paragraph structure.

Tables use their own element ID as the transition key, even when stored data contains a `refId`. Their columns have pixel widths, so tweening the containing frame can leave the columns out of step with it. Cutting between tables avoids that partial animation.

Converted presentations can carry numeric reference IDs. Those IDs remain valid transition keys so existing presentations play as saved.
