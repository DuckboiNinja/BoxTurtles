"""Launcher preflight checks use temporary listeners and never import the app."""
import json
import socket
import sys
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from types import ModuleType

import pytest

import website


HOST = "127.0.0.1"
SCHEMA = {
    "openapi": "3.1.0",
    "info": {"title": "Asian Baddies · Turtle Survey API", "version": "1.0.0"},
    "paths": {"/api/health": {}, "/api/detections": {}, "/api/settings": {}},
}


@contextmanager
def http_listener(body, content_type="application/json"):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer((HOST, 0), Handler)
    server.daemon_threads = True
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
    thread.start()
    try:
        yield server.server_port, requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_existing_server_recognizes_the_dashboard_schema():
    with http_listener(json.dumps(SCHEMA).encode()) as (port, requests):
        assert website.existing_server(HOST, port) == "dashboard"
        assert requests == ["/openapi.json"]


@pytest.mark.parametrize("body, content_type", [
    (json.dumps({**SCHEMA, "info": {"title": "Another local application"}}).encode(), "application/json"),
    (json.dumps({**SCHEMA, "paths": {"/api/health": {}}}).encode(), "application/json"),
    (b"not valid JSON", "application/json"),
    (b"<html><body>A different website</body></html>", "text/html"),
])
def test_existing_server_does_not_mistake_another_http_service_for_the_dashboard(body, content_type):
    with http_listener(body, content_type) as (port, requests):
        assert website.existing_server(HOST, port) == "other"
        assert requests == ["/openapi.json"]


def test_existing_server_reports_an_occupied_unresponsive_socket():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind((HOST, 0))
        listener.listen(16)
        assert website.existing_server(HOST, listener.getsockname()[1]) == "other"


def test_existing_server_returns_none_for_a_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind((HOST, 0))
        port = listener.getsockname()[1]
    assert website.existing_server(HOST, port) is None


@pytest.mark.parametrize("server, expected_code, expected_message", [
    ("dashboard", 0, "already running"),
    ("other", 1, "Port 8000 is already in use by another application"),
])
def test_main_handles_an_existing_listener_before_importing_or_building(tmp_path, monkeypatch, capsys, server, expected_code, expected_message):
    monkeypatch.setattr(website, "ROOT", tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(website, "existing_server", lambda host=HOST, port=8000: server)

    def unexpected_build(*_, **__):
        pytest.fail("An existing listener must be handled before looking for Node or building the UI.")

    monkeypatch.setattr(website.subprocess, "run", unexpected_build)
    monkeypatch.setattr(website.shutil, "which", unexpected_build)
    # A recognized running app should work even when this launcher's Python lacks
    # optional server dependencies; neither case may reach the backend app import.
    for dependency in ("uvicorn", "fastapi", "sqlalchemy"):
        monkeypatch.setitem(sys.modules, dependency, None)
    backend = ModuleType("backend.app.main")

    def backend_access(name):
        if name == "app":
            pytest.fail("The running backend must not be imported or reinitialized by preflight.")
        raise AttributeError(name)

    backend.__getattr__ = backend_access
    monkeypatch.setitem(sys.modules, "backend.app.main", backend)
    assert website.main() == expected_code
    output = capsys.readouterr().out
    assert expected_message in output
    if server == "dashboard":
        assert "http://127.0.0.1:8000" in output
    assert "Install dependencies first" not in output
