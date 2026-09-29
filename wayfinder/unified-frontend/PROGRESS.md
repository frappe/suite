# Unified frontend: implementation ledger

The orchestrator session updates this file after each unit lands. The plan
is [`unified-frontend-plan.md`](unified-frontend-plan.md).

## Run rules (Faris, 2026-09-29)

- Scope: stages 0 to 6 and 8 to 12, Drive issues 39, 41 to 45 and 47, and
  Suite asks S1 to S4. Then a local rehearsal of both flip states. The run
  stops before stage 7.
- Stage 0 merge needs no approval pause.
- No push during the run. Every merge is local to `forge/drive-layer`.
- Opus agents on medium effort implement. Codex `gpt-5.6-sol` reviews,
  researches and gives second opinions.
- Error tracking (Sentry) is out of this run.
- Site lock: every `run-tests`, `migrate`, `bench execute` and browser
  journey on `slides.localhost` runs under `flock /tmp/suite-uf-site.lock`.

## Units

| Unit | Branch | Status | Merge | Notes |
|---|---|---|---|---|
| Stage 0 baseline | `forge/uf-0-baseline` | in progress | | |
| Stage 1 frame rework | | waiting on 0 | | |
| Stage 2 link credentials | | waiting on 0 | | |
| Stage 3 four fixes | | waiting on 0 | | |
| Stage 4 settings | | waiting on 1, Drive 39 | | |
| Stage 5 adoption | | waiting on 1, 3, 4 | | |
| Stage 6 flip plumbing | | waiting on 5 | | |
| Stage 8 guest and link routes | | waiting on 1, 2, 6, Drive 43, S2, S3 | | |
| Stage 9 sharing dialog | | waiting on 8, Drive 43, 44, S1 | | |
| Stage 10 upload, restore, batch | | waiting on 8, Drive 42 | | |
| Stage 11 document surfaces | | waiting on 0 (parts on 2, 8, 9, Drive 47) | | |
| Stage 12 drive flip plumbing | | waiting on 0 (client half on 6), Drive 43, 45 | | |
| Drive 39 settings and webdav routes | | waiting on 0 | | |
| Drive 41 storage breakdown | | waiting on 0 | | |
| Drive 42 upload, restore, purge routes | | waiting on 0 | | |
| Drive 43 link routes and unlock | | waiting on 0 | | |
| Drive 44 grants, passwords, share email | | waiting on 0 | | |
| Drive 45 legacy-call counter | | waiting on 0 | | |
| Drive 47 recents content doctype filter | | waiting on 0 | | |
| Suite S1 to S4 | | waiting on 0 | | |
| Flip rehearsal | | waiting on all | | |

## Open questions for Faris

None yet.

## Baselines

Recorded by stage 0.
