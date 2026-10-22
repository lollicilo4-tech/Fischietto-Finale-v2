import asyncio
import unittest
from unittest.mock import patch

from fastapi.responses import JSONResponse

from app import main, pipeline


class ApiErrorDisclosureTests(unittest.TestCase):
    def test_api_errors_are_logged_but_not_returned_to_clients(self):
        cases = (
            (main.turno, "build_turno", "/api/turno"),
            (main.storico, "build_storico", "/api/storico"),
            (main.classifica, "build_classifica", "/api/classifica"),
        )
        for endpoint, pipeline_method, path in cases:
            with self.subTest(path=path):
                secret_detail = "private-token-or-internal-path"
                with patch.object(pipeline, pipeline_method, side_effect=RuntimeError(secret_detail)):
                    response = asyncio.run(endpoint())
                self.assertIsInstance(response, JSONResponse)
                self.assertEqual(response.status_code, 502)
                self.assertNotIn(secret_detail, response.body.decode("utf-8"))
                self.assertIn("temporaneamente non disponibile", response.body.decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
