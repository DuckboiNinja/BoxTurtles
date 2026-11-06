import json
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.config import Config
from backend.app.main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Config(data_dir=tmp_path, seed_demo=False))) as connection:
        yield connection


def jpeg(*, captured_at=None):
    stream = BytesIO()
    image = Image.new("RGB", (320, 240), "#536e39")
    exif = image.getexif()
    if captured_at:
        exif[36867], exif[36881] = captured_at, "+00:00"
    image.save(stream, "JPEG", exif=exif)
    return stream.getvalue()


def ingest(client, **overrides):
    envelope = {"source": "scrcpy-window", "metadata": {}, **overrides}
    return client.post("/api/ingest/frame", files={"file": ("live-frame.jpg", jpeg(), "image/jpeg")}, data={"envelope": json.dumps(envelope)})


@pytest.mark.parametrize("timestamp,stored", [("2026-11-06T12:34:56.789Z", "2026-11-06T12:34:56.789000+00:00"),
                                              ("2026-11-06T07:34:56-05:00", "2026-11-06T07:34:56-05:00")])
def test_live_snapshot_time_is_measured_and_provenanced_without_gps_or_backfill(client, timestamp, stored):
    older = ingest(client).json()["data"]["detections"][0]
    response = ingest(client, frame_captured_at=timestamp)
    assert response.status_code == 201
    item = response.json()["data"]["detections"][0]
    assert item["captured_at"] == stored
    assert item["latitude"] is None and item["longitude"] is None
    assert item["metadata"]["provenance"] == {"captured_at": "browser frame capture"}
    assert item["metadata"]["missing"] == ["gps"]
    assert any("mirrored view may be delayed" in warning and "not the original camera capture time" in warning for warning in item["metadata"]["warnings"])
    assert item["uploaded_at"] != item["captured_at"]
    assert client.get(f"/api/detections/{older['id']}").json()["data"]["captured_at"] is None


def test_live_snapshot_timestamp_rejects_a_missing_timezone_before_saving(client):
    response = ingest(client, frame_captured_at="2026-11-06T12:34:56")
    assert response.status_code == 422
    assert "timezone" in response.json()["error"]["message"]
    assert client.get("/api/stats").json()["data"]["images"] == 0


def test_original_supplied_capture_metadata_takes_precedence_over_live_snapshot_time(client):
    response = ingest(client, frame_captured_at="2026-11-06T12:34:56Z", metadata={"captured_at": "2024-06-01T10:00:00", "latitude": 0, "longitude": 0})
    assert response.status_code == 201
    item = response.json()["data"]["detections"][0]
    assert item["captured_at"] == "2024-06-01T10:00:00"
    assert item["latitude"] == 0 and item["longitude"] == 0
    assert item["metadata"]["provenance"]["captured_at"] == "upstream source"
    assert not any("Live mirror snapshot" in warning for warning in item["metadata"]["warnings"])


def test_embedded_original_capture_time_takes_precedence_over_live_snapshot_time(client):
    response = client.post("/api/ingest/frame", files={"file": ("live-with-original-exif.jpg", jpeg(captured_at="2024:06:01 10:00:00"), "image/jpeg")},
                           data={"envelope": json.dumps({"source": "scrcpy-window", "frame_captured_at": "2026-11-06T12:34:56Z"})})
    assert response.status_code == 201
    item = response.json()["data"]["detections"][0]
    assert item["captured_at"] == "2024-06-01T10:00:00+00:00"
    assert item["metadata"]["provenance"]["captured_at"] == "EXIF DateTimeOriginal"


def test_absent_or_null_snapshot_time_stays_unknown(client):
    for options in ({}, {"frame_captured_at": None}):
        response = ingest(client, **options)
        assert response.status_code == 201
        item = response.json()["data"]["detections"][0]
        assert item["captured_at"] is None
        assert item["metadata"]["provenance"] == {}
        assert item["metadata"]["missing"] == ["gps", "captured_at"]


def test_other_sources_cannot_claim_a_browser_live_snapshot_timestamp(client):
    response = ingest(client, source="manual-upload", frame_captured_at="2026-11-06T12:34:56Z")
    assert response.status_code == 422
    assert "scrcpy-window" in response.json()["error"]["message"]
    assert client.get("/api/stats").json()["data"]["images"] == 0
