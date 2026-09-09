"""`run_cleanup`: order, checkpointing, resume, rerun-gates, and refusal."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from suite.drive.patches.cleanup.gate import CleanupAuthorizationError, LegacyCallerGateError
from suite.drive.patches.cleanup.patch import PHASES, run_cleanup
from suite.drive.patches.cleanup.readiness import PortNotReadyError
from suite.drive.patches.cleanup.removal import CleanupPatchError
from suite.drive.patches.cleanup.tests.fakes import (
    FakeClientCallerEvidence,
    FakeFileTable,
    FakeForwarders,
    FakeSourceSchema,
    FakeThumbnails,
    FakeTransaction,
    RaisingSchema,
    cleanup_environment,
    fake_blob_columns,
)


def _healthy_env(tmp_path, **overrides):
    files = FakeFileTable().add("Drive").add("Users", folder=None).add("a", folder="Drive", has_node=True)
    forwarders = FakeForwarders({"api.s3.fetch": "permanent"})
    kwargs = dict(
        files=files,
        blob_columns=fake_blob_columns(),
        forwarders=forwarders,
        authorized=True,
        backup_ref="s3://backups/2026-09-09",
    )
    kwargs.update(overrides)
    return cleanup_environment(tmp_path, **kwargs)


class TestRunCleanupRefusals(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_a_failing_gate_refuses_before_any_phase_runs(self):
        env = _healthy_env(
            self.path,
            forwarders=FakeForwarders({"api.files.upload_file": "forwarder"}),
            callers=FakeClientCallerEvidence({"api.files.upload_file"}),
        )
        with self.assertRaises(LegacyCallerGateError):
            run_cleanup(env)
        self.assertEqual(env.files.deleted, [])
        self.assertFalse(env.state.path.exists())

    def test_gates_passing_without_authorization_still_refuses(self):
        env = _healthy_env(self.path, authorized=False)
        with self.assertRaises(CleanupAuthorizationError):
            run_cleanup(env)
        self.assertEqual(env.files.deleted, [])
        self.assertFalse(env.state.path.exists())

    def test_gates_passing_without_backup_ref_still_refuses(self):
        env = _healthy_env(self.path, backup_ref=None)
        with self.assertRaises(CleanupAuthorizationError):
            run_cleanup(env)
        self.assertEqual(env.files.deleted, [])

    def test_an_unready_port_refuses_before_any_phase_runs(self):
        # `RaisingSchema` mimics the real `SiteSchemaGateway`'s honest
        # `NotImplementedError` for `drop_child_table_field`/
        # `remove_permission_hooks`: activation must fail here, in
        # preflight, not partway through phase 3 or 4 after rows and
        # doctypes are already gone.
        env = _healthy_env(self.path, schema=RaisingSchema())
        with self.assertRaises(PortNotReadyError):
            run_cleanup(env)
        self.assertEqual(env.files.deleted, [])
        self.assertFalse(env.state.path.exists())

    def test_source_schema_still_declared_refuses_before_any_phase_runs(self):
        env = _healthy_env(
            self.path,
            source_schema=FakeSourceSchema(still_declared={"Drive Notification": {"from_user"}}),
        )
        with self.assertRaises(PortNotReadyError):
            run_cleanup(env)
        self.assertEqual(env.files.deleted, [])
        self.assertFalse(env.state.path.exists())

    def test_permission_hooks_still_present_refuses_before_any_phase_runs(self):
        env = _healthy_env(self.path, source_schema=FakeSourceSchema(still_hooked={"Drive Permission"}))
        with self.assertRaises(PortNotReadyError):
            run_cleanup(env)
        self.assertEqual(env.files.deleted, [])
        self.assertFalse(env.state.path.exists())

    def test_preflight_runs_before_the_gates(self):
        # An unready port and a failing gate both present: preflight's
        # refusal must win, since gates passing on a site that cannot
        # finish the run is not actually safe to start.
        env = _healthy_env(
            self.path,
            schema=RaisingSchema(),
            forwarders=FakeForwarders({"api.files.upload_file": "forwarder"}),
            callers=FakeClientCallerEvidence({"api.files.upload_file"}),
        )
        with self.assertRaises(PortNotReadyError):
            run_cleanup(env)


class TestRunCleanupOrder(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_every_phase_runs_in_the_declared_order_and_checkpoints(self):
        env = _healthy_env(self.path)
        results = run_cleanup(env)
        names = [name for name, _phase in PHASES]
        self.assertEqual(list(results), names)
        for name in names:
            self.assertTrue(env.state.get(name).completed, msg=name)

    def test_gates_run_once_per_call_not_once_per_phase(self):
        # Re-checking before every one of eight phases bought no real
        # safety over checking once per call (Cleanup is single-actor and
        # serial within a run) for the cost of up to ten full `File` scans
        # a run; a genuine resume still gets a fully fresh check, because
        # that is a new call to `run_cleanup`.
        env = _healthy_env(self.path)
        calls = []
        from suite.drive.patches.cleanup import patch as patch_module

        original = patch_module.check_gates

        def counting(*args, **kwargs):
            calls.append(1)
            return original(*args, **kwargs)

        with patch.object(patch_module, "check_gates", side_effect=counting):
            run_cleanup(env)
        self.assertEqual(len(calls), 1)

    def test_preflight_and_gates_run_before_the_first_mutation(self):
        env = _healthy_env(self.path)
        order = []
        from suite.drive.patches.cleanup import patch as patch_module

        original_preflight = patch_module.run_preflight
        original_gates = patch_module.check_gates
        original_phase = patch_module.phase_file_rows

        def tracking_preflight(*args, **kwargs):
            order.append("preflight")
            return original_preflight(*args, **kwargs)

        def tracking_gates(*args, **kwargs):
            order.append("gates")
            return original_gates(*args, **kwargs)

        def tracking_phase(*args, **kwargs):
            order.append("phase_file_rows")
            return original_phase(*args, **kwargs)

        with (
            patch.object(patch_module, "run_preflight", side_effect=tracking_preflight),
            patch.object(patch_module, "check_gates", side_effect=tracking_gates),
            patch.object(patch_module, "phase_file_rows", side_effect=tracking_phase),
        ):
            run_cleanup(env)
        self.assertEqual(order, ["preflight", "gates", "phase_file_rows"])

    def test_each_phase_commits_before_its_checkpoint_is_written(self):
        env = _healthy_env(self.path)
        run_cleanup(env)
        self.assertEqual(env.transaction.commits, len(PHASES))

    def test_a_commit_failure_leaves_no_checkpoint_for_that_phase(self):
        transaction = FakeTransaction()
        env = _healthy_env(self.path, transaction=transaction)
        transaction.fail_next = True
        with self.assertRaises(RuntimeError):
            run_cleanup(env)
        # `file_rows`' own `DELETE`s already landed (a real DB commit
        # failure does not undo prior statements in the same transaction),
        # but with no checkpoint recorded, a resume must redo this phase
        # rather than skip it as already done.
        self.assertFalse(env.state.get("file_rows").completed)
        self.assertEqual(transaction.commits, 0)

        # Resuming re-runs the phase whose commit failed; its ports are
        # idempotent, so replaying it against already-mutated fakes is safe.
        run_cleanup(env)
        self.assertTrue(env.state.get("file_rows").completed)


class TestRunCleanupResume(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_a_completed_phase_is_not_rerun_on_resume(self):
        env = _healthy_env(self.path)
        run_cleanup(env)

        # A fresh process, same durable state file: every phase reads back
        # `completed`, so a second run must not touch any fake's ports at all.
        second_env = _healthy_env(self.path)
        second_env.state = env.state
        run_cleanup(second_env)
        self.assertEqual(second_env.files.deleted, [])
        self.assertEqual(second_env.files.delete_calls, [])

    def test_a_crash_mid_phase_leaves_earlier_phases_completed(self):
        env = _healthy_env(self.path)
        from suite.drive.patches.cleanup import patch as patch_module

        def exploding(env):
            raise RuntimeError("simulated crash")

        # `PHASES`' lambdas resolve `phase_legacy_doctypes` as a global name
        # in `patch.py`'s own namespace at call time, so patching it there
        # (not on `removal`, where it was merely imported from) is what a
        # crash inside that one phase actually looks like.
        with patch.object(patch_module, "phase_legacy_doctypes", side_effect=exploding):
            with self.assertRaises(RuntimeError):
                run_cleanup(env)

        self.assertTrue(env.state.get("file_rows").completed)
        self.assertTrue(env.state.get("custom_fields").completed)
        self.assertFalse(env.state.get("legacy_doctypes").completed)
        self.assertFalse(env.state.get("content_history").completed)

        # Resuming re-runs only what did not finish.
        run_cleanup(env)
        self.assertTrue(env.state.get("legacy_doctypes").completed)
        self.assertTrue(env.state.get("content_history").completed)

    def test_a_crash_after_phase_ones_commit_but_before_its_checkpoint_still_lets_sidecars_delete_on_resume(
        self,
    ):
        """The exact crash window: `phase_file_rows`' own `DELETE`s land (the
        fake mutates unconditionally, standing in for a real DB commit that
        already landed), but `env.transaction.commit()` itself fails, so
        `patch.run_cleanup` never reaches `env.state.put("file_rows", ...)`.
        A resumed call must reuse the census/settings this phase already
        persisted before the crash, not rescan the now-empty File table and
        overwrite them with an empty one — proven not by checking the
        checkpoint alone, but by running all the way through phase 7 and
        confirming the sidecar for a name phase 1 already deleted is still
        found and removed.
        """
        thumbnails = FakeThumbnails(existing={"a"})
        transaction = FakeTransaction()
        env = _healthy_env(self.path, thumbnails=thumbnails, transaction=transaction)
        transaction.fail_next = True
        with self.assertRaises(RuntimeError):
            run_cleanup(env)
        self.assertFalse(env.state.get("file_rows").completed)
        census_after_crash = env.state.get_census()
        self.assertIsNotNone(census_after_crash)
        self.assertIn("a", census_after_crash)
        self.assertEqual(env.files.rows, {})  # phase 1's DELETEs already landed

        run_cleanup(env)  # resume

        self.assertTrue(env.state.get("file_rows").completed)
        self.assertEqual(env.state.get_census(), census_after_crash)  # not overwritten empty
        self.assertEqual(thumbnails.existing, set())  # "a"'s sidecar was actually deleted

    def test_a_corrupt_state_file_is_quarantined_not_silently_reset(self):
        env = _healthy_env(self.path)
        run_cleanup(env)
        env.state.path.write_text("{not json", encoding="utf-8")
        # A fresh read quarantines the corrupt file instead of losing it,
        # and treats the phase as not-yet-recorded (safe: rerunning a
        # completed phase against an empty fixture is a no-op).
        self.assertFalse(env.state.get("file_rows").completed)
        quarantined = list(env.state.path.parent.glob("*.corrupt-*"))
        self.assertEqual(len(quarantined), 1)


if __name__ == "__main__":
    unittest.main()
