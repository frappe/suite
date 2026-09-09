"""§14.2: the thirteen Build steps, in order, as one patch.

`execute()` is what `suite/patches.txt` names. Everything below it takes an
environment, so the whole order runs against `tests.fakes` with no site.

Three things this module owns and no phase does:

- **The order.** §14.2 numbers the steps and the numbering is a dependency
  order: grants need nodes, content needs grants, usage needs all of them.
- **The two `completed` flags the phases read but never set.** `tree` and
  `grants` are marked complete here, after their step returns, because a
  step that raised partway has not completed and a later phase must refuse
  to start on it.
- **The second content pass.** Step 10 adopts a content document that has
  no `File` row and gives it a node. Step 8 already ran, so a deck adopted
  this way has no media children yet and step 8 recorded it as deferred.
  Running 8 and 10 again converts it. The loop is bounded: adoption is a
  one-shot set, so the second pass finds nothing left to adopt, and a
  record that is still incomplete after `CONTENT_PASSES` is a defect that
  must stop the migration rather than be retried forever.

Build deletes one thing: the `DocShare` rows it has rewritten as grants
(steps 6 and 10). §5.13's read guards fail closed on a share for a governed
doctype and `framework.validate_content_registry` refuses the migration
while one is left, so they cannot wait for §14.10 Cleanup. Their full
column set is journaled under the site's private directory first, so §14.11
can put them back. Every other legacy column Build read is still there when
it returns.
"""

import frappe

from suite.drive.patches.build.content import link_content_documents
from suite.drive.patches.build.environment import BUILD_BATCH_SIZE, BuildEnvironment
from suite.drive.patches.build.grants import convert_grants
from suite.drive.patches.build.history import convert_history_and_comments
from suite.drive.patches.build.legacy_bytes import prepare_legacy_bytes
from suite.drive.patches.build.records import convert_records
from suite.drive.patches.build.report import produce_report
from suite.drive.patches.build.root_pairs import convert_root_pairs
from suite.drive.patches.build.settings import convert_settings
from suite.drive.patches.build.slides import convert_slides_and_templates
from suite.drive.patches.build.tree import convert_trees
from suite.drive.patches.build.usage import recompute_usage

# Two is what the adoption rule needs. The third is margin, and reaching it
# means the content record disagrees with itself.
CONTENT_PASSES = 3


class BuildPatchError(frappe.ValidationError):
    """Build cannot finish, and the site must not be left calling it done."""


def execute() -> None:
    """The migration entry point. Runs §14.2 steps 1 to 13 on this site."""
    run_build(BuildEnvironment.for_site())


def run_build(env, *, batch_size: int = BUILD_BATCH_SIZE) -> dict:
    """Run every Build step against `env` and answer §14.9's report.

    Resumable at any batch boundary. Each step reads the durable record,
    redoes only what the target is missing, and recomputes its census from
    the source rows, so a run that resumes after a kill reports the same
    numbers as one that was never interrupted.
    """
    # Step 1 is the gate, and step 2 and 3 are the byte preparation. The
    # gate runs inside `prepare_legacy_bytes`: it has to be the first thing
    # that touches the bucket, before the backfill commits anything.
    prepare_legacy_bytes(env, batch_size=batch_size)

    plans = _convert_tree(env, batch_size=batch_size)
    _convert_grants(env, plans, batch_size=batch_size)
    _convert_content(env, batch_size=batch_size)

    convert_settings(env, batch_size=batch_size)
    # §14.2: the recompute is the last step that writes.
    recompute_usage(env, batch_size=batch_size)

    report, _path = produce_report(env)
    return report


def _convert_tree(env, *, batch_size: int):
    """Steps 4 and 5. Answers the root plans step 6's Shared floor needs."""
    tree = env.state.tree()
    tree.begin_run()
    env.state.put_tree(tree)
    plans = convert_root_pairs(env, tree, batch_size=batch_size)
    convert_trees(env, tree, plans, batch_size=batch_size)
    tree.completed = True
    env.state.put_tree(tree)
    return plans


def _convert_grants(env, plans, *, batch_size: int):
    """Step 6."""
    grants = env.state.grants()
    # `links_minted` and its write-ahead ledger are cumulative, so this
    # clears the census and keeps the record of what was already published.
    grants.begin_run()
    env.state.put_grants(grants)
    convert_grants(env, grants, plans, batch_size=batch_size)
    grants.completed = True
    env.state.put_grants(grants)
    return grants


def _convert_content(env, *, batch_size: int):
    """Steps 7 to 10, with the second pass step 10's adoptions need."""
    convert_history_and_comments(env, batch_size=batch_size)
    content = convert_slides_and_templates(env, batch_size=batch_size)
    # Step 9 reads `Drive Favourite`, `Drive Entity Log`, the activity log,
    # the legacy routes, and the DAV tables. Every one of them keys on a
    # `File` id, and step 10 adopts documents that have no `File` row, so
    # nothing step 10 creates can change step 9's answer. It runs in the
    # position §14.2 gives it.
    convert_records(env, batch_size=batch_size)

    for _ in range(CONTENT_PASSES):
        content = link_content_documents(env, batch_size=batch_size)
        if content.completed:
            return content
        content = convert_slides_and_templates(env, batch_size=batch_size)

    raise BuildPatchError(
        "Build's content record is still incomplete after "
        f"{CONTENT_PASSES} passes: history_completed="
        f"{content.history_completed}, slides_completed={content.slides_completed}, "
        f"links_completed={content.links_completed}, slides_deferred={content.slides_deferred}, "
        f"history_deferred={content.history_deferred}."
    )
