import importlib
import unittest

from suite import hooks


class TestSuiteComposition(unittest.TestCase):
    def test_lifecycle_hooks_are_owned_by_composition(self):
        self.assertEqual(hooks.before_install, "suite.composition.lifecycle.before_install")
        self.assertEqual(hooks.after_install, "suite.composition.lifecycle.after_install")
        self.assertEqual(hooks.after_migrate, "suite.composition.lifecycle.after_migrate")
        self.assertEqual(hooks.after_app_install, "suite.composition.lifecycle.after_app_install")
        self.assertEqual(hooks.extend_bootinfo, "suite.composition.lifecycle.extend_bootinfo")

    def test_user_hooks_are_single_composition_dispatchers(self):
        self.assertEqual(hooks.doc_events["User"]["after_insert"], ["suite.composition.users.after_insert"])
        self.assertEqual(hooks.doc_events["User"]["on_trash"], ["suite.composition.users.on_trash"])

    def test_the_suite_core_lifecycle_shim_is_gone(self):
        """Lifecycle orchestration lives in composition, with no compatibility shim.

        `suite_core` is product-neutral platform code (ARCHITECTURE.md rule
        1.2). Nothing imports `suite.suite_core.boot` any more, so the module
        is removed rather than kept as a re-export.
        """
        with self.assertRaises(ModuleNotFoundError):
            importlib.import_module("suite.suite_core.boot")
