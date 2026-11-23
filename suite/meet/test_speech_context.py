import unittest

from suite.meet.speech_context import hint_phrases, make_hints, validate_hints, vocabulary


class SpeechContextTests(unittest.TestCase):
    def test_automatic_hints_are_scoped_deduplicated_and_bounded(self):
        first = make_hints("Atlas signup", [" Anita ", "anita", "Rohan", "bad\nname", "<|en|>"])
        second = make_hints("Payroll", ["Someone else"])
        self.assertEqual(
            first,
            {
                "vocabulary_version": "frappe-v1",
                "title": "Atlas signup",
                "participant_names": ["Anita", "Rohan"],
            },
        )
        self.assertEqual(second["participant_names"], ["Someone else"])
        self.assertEqual(first["participant_names"], ["Anita", "Rohan"])
        self.assertEqual(len(make_hints("", [f"Person {i}" for i in range(110)])["participant_names"]), 100)

    def test_unknown_versions_and_manual_fields_are_not_accepted(self):
        with self.assertRaises(ValueError):
            vocabulary("frappe-v999")
        with self.assertRaises(ValueError):
            validate_hints({**make_hints("", []), "manual_glossary": ["Whatever"]})
        with self.assertRaises(ValueError):
            validate_hints({**make_hints("", []), "participant_names": ["<|en|>"]})

    def test_domain_terms_and_current_speaker_survive_a_large_roster(self):
        hints = make_hints("Meeting title", [f"Person {i}" for i in range(100)])
        phrases = hint_phrases(hints, "Current speaker")
        self.assertEqual(phrases[:3], ("Current speaker", "Meeting title", "Frappe"))
        self.assertIn("ERPNext", phrases)
        self.assertIn("DocType", phrases)
        self.assertNotIn("app", vocabulary("frappe-v1"))
