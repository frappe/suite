---
description: Create a PR, complete Greptile review, watch CI, and squash-merge.
agent: build
---

Ship the current focused change as a pull request.

1. Inspect status, diffs, recent commits, tracking, and the full base-branch diff. Commit and push only task files to `upstream`, never a fork; leave unrelated changes untouched.
2. Create the PR with a concise Conventional Commit title, for example `fix(meet): handle missing microphone devices`. Do not add a Verification/testing section or describe which tests passed in the PR body.
3. Once created, the remote title, labels, reviewers, and milestone are user-owned. Change them only when explicitly asked; accept remote changes as intentional. Update the body only to reflect follow-up fixes.
4. Fetch Greptile's score and inline threads via GraphQL `pullRequest.reviewThreads`. Fix valid findings and reply with the fix and commit; explain invalid findings in-thread. Repeat until exactly 5/5 with no unresolved threads.
5. Then monitor all CI checks on the latest commit. Diagnose failures, fix those caused by the change, and rerun unrelated flakes without source changes until they pass.
6. Squash-merge only with Greptile at 5/5, no unresolved threads, and all current checks passing.
7. Immediately before merging, reread but do not change the remote title. Preserve it and GitHub's `(#<PR number>)` suffix in the squash commit subject.
8. Confirm the merge, remove the merged branch and its worktree, then report the PR URL and squash commit SHA.

Additional requirements: $ARGUMENTS
