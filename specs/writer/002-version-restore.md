# Restoring a version

Status: done

How a version restore behaves when other people have the document open. Findings R-04, R-06 and R-07 from the Writer review.

## Before the restore

- The confirm dialog names everyone else who has the document open now, from live presence. Each person is named once, even with two tabs open.
- With nobody else present, the dialog says nothing extra.

## After the restore

- The person who restored sees "Version restored".
- Every other open tab shows a toast that names who restored and which version: "Amira Haddad restored the version from 10:42 AM." A named version goes by its name. An unknown version reads "restored an earlier version of this document."
- The restorer's own tabs are not told.
- Other tabs reload their version list.

## Reading position

- The restorer stays on the block they were reading in the preview (or in the editor, when no preview was open).
- Other editors keep their place. Blocks the restore keeps stay in the page, so the browser keeps the scroll.

## Who a version names

- An automatic version names the person who made most of the changes it holds, the latest on a tie. It no longer names whoever's save or sweep happened to take it, such as Administrator.
- The version kept before a restore names the person who restored.
- It is called "Before restoring “<name>”" for a named version, and "Before restoring the version from <time>" otherwise, in the restorer's time zone. Repeated restores no longer all read "Before restoring version N".

## Not in scope

- The one-minute wait between restores (`RESTORE_EVERY_SECONDS`) is unchanged.
- Comparing a version with the current document.
