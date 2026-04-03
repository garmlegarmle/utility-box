"""Localhost web app for the chart interpretation engine."""

from __future__ import annotations

import argparse
import json
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .engine import ChartInterpretationEngine


class ChartInterpretationWebApp:
    """Minimal standard-library web app for local analysis."""

    def __init__(self, host: str, port: int, static_dir: Path, workspace_dir: Path) -> None:
        self.host = host
        self.port = port
        self.static_dir = static_dir
        self.workspace_dir = workspace_dir
        self.output_dir = workspace_dir / "runs"
        self.cache_dir = workspace_dir / "cache"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.engine = ChartInterpretationEngine()

    def run(self) -> None:
        app = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                parsed = urlparse(self.path)
                if parsed.path == "/":
                    self._serve_file(app.static_dir / "index.html", "text/html; charset=utf-8")
                    return
                if parsed.path.startswith("/static/"):
                    target = app.static_dir / parsed.path.removeprefix("/static/")
                    self._serve_file(target)
                    return
                if parsed.path.startswith("/artifacts/"):
                    target = app.workspace_dir / parsed.path.removeprefix("/artifacts/")
                    self._serve_file(target)
                    return
                self.send_error(HTTPStatus.NOT_FOUND, "Not found")

            def do_POST(self) -> None:  # noqa: N802
                parsed = urlparse(self.path)
                if parsed.path == "/api/analyze-ticker":
                    self._handle_ticker_analysis()
                    return
                if parsed.path == "/api/analyze-csv":
                    self._handle_csv_analysis()
                    return
                self.send_error(HTTPStatus.NOT_FOUND, "Not found")

            def log_message(self, format: str, *args) -> None:  # noqa: A003
                return

            def _handle_ticker_analysis(self) -> None:
                body = self._read_json_body()
                ticker = str(body.get("ticker", "")).strip().upper()
                if not ticker:
                    self._send_json({"error": "Ticker is required."}, status=400)
                    return
                artifacts = app.engine.export_ticker(ticker, app.output_dir / ticker, app.cache_dir, period="2y")
                payload = json.loads(artifacts.analysis_json.read_text(encoding="utf-8"))
                self._send_json(self._result_payload(artifacts, payload, label=ticker))

            def _handle_csv_analysis(self) -> None:
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw_body = self.rfile.read(length).decode("utf-8")
                fields = parse_qs(raw_body)
                csv_text = fields.get("csv_text", [""])[0]
                title = fields.get("title", ["uploaded_csv"])[0] or "uploaded_csv"
                if not csv_text.strip():
                    self._send_json({"error": "csv_text is required."}, status=400)
                    return
                safe_title = title.replace("/", "_").replace(" ", "_")
                run_dir = app.output_dir / safe_title
                run_dir.mkdir(parents=True, exist_ok=True)
                csv_path = run_dir / f"{safe_title}.csv"
                csv_path.write_text(csv_text, encoding="utf-8")
                artifacts = app.engine.export_csv(csv_path, run_dir, title=safe_title)
                payload = json.loads(artifacts.analysis_json.read_text(encoding="utf-8"))
                self._send_json(self._result_payload(artifacts, payload, label=safe_title))

            def _read_json_body(self) -> dict[str, object]:
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw = self.rfile.read(length).decode("utf-8")
                return json.loads(raw) if raw else {}

            def _result_payload(self, artifacts, payload: dict[str, object], label: str) -> dict[str, object]:
                base = app.workspace_dir
                return {
                    "label": label,
                    "artifacts": {
                        "analysis_json": "/artifacts/" + str(artifacts.analysis_json.relative_to(base)).replace("\\", "/"),
                        "chart_png": "/artifacts/" + str(artifacts.chart_png.relative_to(base)).replace("\\", "/"),
                        "report_html": "/artifacts/" + str(artifacts.report_html.relative_to(base)).replace("\\", "/"),
                    },
                    "analysis": payload,
                }

            def _serve_file(self, path: Path, content_type: str | None = None) -> None:
                if not path.exists() or not path.is_file():
                    self.send_error(HTTPStatus.NOT_FOUND, "File not found")
                    return
                data = path.read_bytes()
                self.send_response(HTTPStatus.OK)
                guessed = content_type or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
                self.send_header("Content-Type", guessed)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _send_json(self, payload: dict[str, object], status: int = 200) -> None:
                data = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        server = ThreadingHTTPServer((self.host, self.port), Handler)
        print(f"Chart interpretation web app running at http://{self.host}:{self.port}")
        server.serve_forever()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the localhost chart interpretation web app.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--workspace-dir",
        type=Path,
        default=Path("chart_interpretation_web/workspace"),
        help="Directory for generated artifacts and cached downloads.",
    )
    parser.add_argument(
        "--static-dir",
        type=Path,
        default=Path("chart_interpretation_web/static"),
        help="Directory containing the frontend files.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    app = ChartInterpretationWebApp(args.host, args.port, args.static_dir.resolve(), args.workspace_dir.resolve())
    app.run()


if __name__ == "__main__":
    main()
