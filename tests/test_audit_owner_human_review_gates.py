import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/audit-owner-human-review-gates.py"
spec = importlib.util.spec_from_file_location("gate_auditor", SCRIPT)
auditor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auditor)


class AuditRulesTest(unittest.TestCase):
    def test_detects_external_human_review_condition(self):
        for value in [
            "if (!status.independentReview.complete) throw new Error('Human audit required')",
            "required_external_review = true",
            "if require_independent_security_audit(): return blocked",
            "external human auditor must approve before release",
            "human security review signoff is mandatory",
            "reviewer.independent === true",
        ]:
            with self.subTest(value=value):
                self.assertRegex(auditor.normal(value), auditor.TOPIC)

    def test_distinguishes_code_from_records_and_documentation(self):
        self.assertEqual(auditor.kind(".github/workflows/deploy.yml"), "executable-or-config")
        self.assertEqual(auditor.kind("scripts/release-gates.mjs"), "executable-or-config")
        self.assertEqual(auditor.kind("security/e2eesa-status.json"), "schema-or-status")
        self.assertEqual(auditor.kind("tests/release-gates.test.mjs"), "nonexecuting-reference")
        self.assertEqual(auditor.kind("docs/certification.md"), "nonexecuting-reference")
        self.assertEqual(auditor.kind("AGENTS.md"), "agent-policy")

    def test_executable_gate_markers(self):
        self.assertRegex("if(!independentReview.complete) throw", auditor.BLOCK)
        self.assertRegex("deployment blocked", auditor.BLOCK)
        self.assertRegex("certificationEligible === false", auditor.CERTIFICATION)
        self.assertRegex("without waiting for an independent human auditor", auditor.NEGATIVE)

    def test_credential_redaction_and_truncation(self):
        self.assertNotIn("my-secret", auditor.redact("postgresql://user:my-secret@database.example"))
        self.assertLessEqual(len(auditor.redact("x"*2000)), 320)

    def test_enumerated_exemptions_are_only_four_oldest(self):
        self.assertEqual(auditor.EXCLUDED, {"facerec", "hubs", "neurosynth", "pupil"})


if __name__ == "__main__":
    unittest.main()
