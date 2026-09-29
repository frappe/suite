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

    def test_no_room_names_does_not_allocate_a_per_stream_bias_model(self):
        bias = UtteranceBias(object(), [])
        self.assertIsNone(bias.initial_hypotheses())
        bias.release()


if __name__ == "__main__":
    unittest.main()
