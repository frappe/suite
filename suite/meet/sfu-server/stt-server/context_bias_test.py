import unittest

from context_bias import FRAPPE_TERMS, MAX_NAMES, UtteranceBias, validate_names


class ContextBiasTest(unittest.TestCase):
    def test_bounded_roster_is_normalized_and_deduplicated(self):
        self.assertEqual(
            validate_names([" Siobhan ", "siobhan", "Aarav", "田中さん"]),
            ["Siobhan", "Aarav", "田中さん"],
        )
        for names in ("Siobhan", [""], ["\x00person"], ["x" * 81], [1], ["x"] * (MAX_NAMES + 1)):
            with self.subTest(names=names), self.assertRaises(ValueError):
                validate_names(names)

    def test_frappe_terms_are_explicit_product_vocabulary(self):
        self.assertIn("Frappe", FRAPPE_TERMS)
        self.assertIn("ERPNext", FRAPPE_TERMS)
        self.assertIn("DocType", FRAPPE_TERMS)
        self.assertNotIn("app", FRAPPE_TERMS)

    def test_interleaved_rooms_keep_their_own_metadata(self):
        first = UtteranceBias(
            object(), ["Anita"], context={"vocabulary_version": "frappe-v1", "title": "Atlas signup"}
        )
        second = UtteranceBias(
            object(), ["Rohan"], context={"vocabulary_version": "frappe-v1", "title": "Payroll review"}
        )
        self.assertIn("Atlas signup", first.phrases)
        self.assertNotIn("Rohan", first.phrases)
        self.assertNotIn("Atlas signup", second.phrases)
        self.assertIn("Rohan", second.phrases)
        first.release()
        self.assertIn("Rohan", second.phrases)

    def test_empty_roster_still_selects_versioned_product_hints(self):
        bias = UtteranceBias(object(), [])
        self.assertIn("ERPNext", bias.phrases)
        self.assertEqual(bias.context["vocabulary_version"], "frappe-v1")
        bias.release()


if __name__ == "__main__":
    unittest.main()
