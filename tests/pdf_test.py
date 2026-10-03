"""PDF output correctness and stable-output retry contract."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
from pdf import render_pdf


class PdfTests(unittest.TestCase):
    def test_valid_pdf_and_idempotent_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            render_pdf("INV-test", "Synthetic customer", 12345, directory)
            path = Path(directory) / "INV-test.pdf"
            content = path.read_bytes()
            self.assertTrue(content.startswith(b"%PDF-"))
            self.assertTrue(content.rstrip().endswith(b"%%EOF"))
            before = path.stat().st_mtime_ns
            render_pdf("INV-test", "Synthetic customer", 12345, directory)
            self.assertEqual(before, path.stat().st_mtime_ns)
            self.assertEqual(content, path.read_bytes())
            self.assertFalse(path.with_suffix(".tmp").exists())


if __name__ == "__main__":
    unittest.main()
