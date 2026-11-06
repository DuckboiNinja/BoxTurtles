import json
import sqlite3
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from backend.app.config import Config
from backend.app.db import CapturedImage, Detection
from backend.app.main import create_app
from backend.app.schemas import Candidate


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Config(data_dir=tmp_path, seed_demo=False))) as connection:
        yield connection


@pytest.fixture
def jpeg():
    output = BytesIO()
    Image.new("RGB", (320, 240), "#234a2f").save(output, "JPEG")
    return output.getvalue()


def configure(client, **changes):
    return client.put("/api/settings", json=client.get("/api/settings").json()["data"] | changes)


def local_model(client, tmp_path, monkeypatch, candidates):
    from backend.app import engine

    calls = []

    class LocalYolo:
        def __init__(self, path, labels):
            pass

        def predict(self, image, threshold):
            calls.append(image.size)
            return [candidate for candidate in candidates if candidate.confidence >= threshold]

    monkeypatch.setattr(engine, "YoloDetector", LocalYolo)
    weights = tmp_path / "local-test.pt"
    weights.write_bytes(b"test adapter; no model download or Ultralytics needed")
    model_id = client.post("/api/models", json={"name": "Local fixture YOLO", "path": str(weights), "labels": []}).json()["data"]["id"]
    assert configure(client, active_model_id=model_id).status_code == 200
    return calls


def frame(client, jpeg, persist=False, **envelope):
    payload = {"source": "scrcpy-window", "metadata": {}} | envelope
    return client.post("/api/inference/frame", files={"file": ("live.jpg", jpeg, "image/jpeg")},
                       data={"envelope": json.dumps(payload), "persist_candidates": str(persist).lower()})


def candidate(score=0.97, label="turtle"):
    return Candidate(class_name=label, confidence=score, bounding_box=(20, 25, 150, 130))


def test_viewer_frames_are_ephemeral_and_run_inference_once(client, jpeg, tmp_path, monkeypatch):
    calls = local_model(client, tmp_path, monkeypatch, [candidate()])
    assert configure(client, auto_accept_enabled=True, auto_accept_threshold=0.95).status_code == 200
    before_files = list((client.app.state.storage / "media").rglob("*"))
    response = frame(client, jpeg, frame_captured_at="2026-11-06T01:02:03.456Z")
    assert response.status_code == 200, response.json()
    data = response.json()["data"]
    assert calls == [(320, 240)]
    assert (data["width"], data["height"]) == (320, 240)
    assert data["image_id"] is None
    assert data["is_mock"] is False and data["model_name"] == "Local fixture YOLO"
    assert data["inference_ms"] >= 0
    assert data["detections"][0]["bounding_box"] == [20, 25, 150, 130]
    assert data["detections"][0]["status"] is None
    assert data["metadata"]["provenance"]["captured_at"] == "browser frame capture"
    assert data["metadata"]["missing"] == ["gps"]
    assert client.get("/api/stats").json()["data"]["images"] == 0
    assert list((client.app.state.storage / "media").rglob("*")) == before_files


def test_viewer_can_save_candidates_once_with_threshold_audit(client, jpeg, tmp_path, monkeypatch):
    calls = local_model(client, tmp_path, monkeypatch, [candidate(0.95), candidate(0.949), candidate(0.99, "BOX-TURTLE"), candidate(0.99, "bird")])
    assert configure(client, auto_accept_enabled=True, auto_accept_threshold=0.95).status_code == 200
    response = frame(client, jpeg, persist=True, frame_captured_at="2026-11-06T01:02:03Z")
    assert response.status_code == 200, response.json()
    data = response.json()["data"]
    assert calls == [(320, 240)]
    assert data["image_id"] is not None
    assert [item["status"] for item in data["detections"]] == ["verified", "pending", "verified", "pending"]
    auto = data["detections"][0]
    assert auto["review_method"] == "auto-confidence" and auto["auto_accept_threshold"] == 0.95
    assert auto["reviewed_at"]
    assert auto["captured_at"] == "2026-11-06T01:02:03+00:00"
    assert auto["metadata"]["provenance"]["captured_at"] == "browser frame capture"
    assert auto["latitude"] is None and auto["longitude"] is None
    assert data["detections"][1]["review_method"] is None
    assert (client.app.state.storage / "media" / data["image_id"] / "source.bin").read_bytes() == jpeg
    assert client.get("/api/stats").json()["data"]["verified"] == 2
    assert client.post(f"/api/detections/{auto['id']}/verify").status_code == 409
    reset = client.post(f"/api/detections/{auto['id']}/reset").json()["data"]
    assert reset["status"] == "pending" and reset["review_method"] is None and reset["auto_accept_threshold"] is None
    manual = client.post(f"/api/detections/{auto['id']}/verify").json()["data"]
    assert manual["review_method"] == "human" and manual["auto_accept_threshold"] is None


def test_viewer_no_candidates_does_not_save_empty_frames(client, jpeg, tmp_path, monkeypatch):
    calls = local_model(client, tmp_path, monkeypatch, [])
    data = frame(client, jpeg, persist=True).json()["data"]
    assert data["image_id"] is None and data["detections"] == []
    assert calls == [(320, 240)]
    assert list((client.app.state.storage / "media").iterdir()) == []
    assert client.get("/api/stats").json()["data"]["images"] == 0


def test_auto_accept_defaults_off_and_only_changes_future_local_results(client, jpeg, tmp_path, monkeypatch):
    local_model(client, tmp_path, monkeypatch, [candidate()])
    initial = client.get("/api/settings").json()["data"]
    assert initial["auto_accept_enabled"] is False and initial["auto_accept_threshold"] == 0.95
    first = client.post("/api/upload", files={"file": ("survey.jpg", jpeg)}).json()["data"]["detections"][0]
    assert first["status"] == "pending"
    assert configure(client, auto_accept_enabled=True).status_code == 200
    assert client.get(f"/api/detections/{first['id']}").json()["data"]["status"] == "pending"
    second = client.post("/api/ingest/frame", files={"file": ("frame.jpg", jpeg)}).json()["data"]["detections"][0]
    assert second["status"] == "verified" and second["review_method"] == "auto-confidence"


def test_auto_accept_never_accepts_demo_or_external_candidates(client, jpeg):
    assert configure(client, auto_accept_enabled=True, auto_accept_threshold=0.8).status_code == 200
    demo = client.post("/api/upload", files={"file": ("survey.jpg", jpeg)}).json()["data"]["detections"][0]
    assert demo["is_mock"] and demo["status"] == "pending"
    viewer = frame(client, jpeg, persist=True).json()["data"]
    assert viewer["is_mock"] and viewer["detections"][0]["status"] == "pending"
    supplied = {"source": "scrcpy-window", "model_id": "pretend-yolo", "is_mock": False,
                "detections": [candidate(0.99).model_dump()]}
    external = client.post("/api/ingest/frame", files={"file": ("frame.jpg", jpeg)},
                           data={"envelope": json.dumps(supplied)}).json()["data"]["detections"][0]
    assert external["status"] == "pending" and external["review_method"] is None


def test_setting_validation_and_old_clients_preserve_auto_accept_policy(client):
    assert configure(client, auto_accept_enabled=True, auto_accept_threshold=0.92).status_code == 200
    values = client.get("/api/settings").json()["data"]
    del values["auto_accept_enabled"], values["auto_accept_threshold"]
    values["max_frames"] = 4
    response = client.put("/api/settings", json=values)
    assert response.status_code == 200
    assert response.json()["data"]["auto_accept_enabled"] is True
    assert response.json()["data"]["auto_accept_threshold"] == 0.92
    assert configure(client, auto_accept_threshold=1.01).status_code == 422
    assert configure(client, auto_accept_threshold=0).status_code == 422
    assert configure(client, confidence_threshold=0.95).status_code == 422
    assert configure(client, confidence_threshold=0.95, auto_accept_enabled=False).status_code == 200


def test_viewer_auth_validation_and_invalid_boxes_write_nothing(tmp_path, jpeg, monkeypatch):
    with TestClient(create_app(Config(data_dir=tmp_path, seed_demo=False, ingest_token="secret"))) as secured:
        assert frame(secured, jpeg).status_code == 401
        authorized = secured.post("/api/inference/frame", files={"file": ("frame.jpg", jpeg)}, headers={"X-Ingest-Token": "secret"})
        assert authorized.status_code == 200
        assert authorized.json()["data"]["is_mock"] is True
    with TestClient(create_app(Config(data_dir=tmp_path, seed_demo=False))) as client:
        assert frame(client, jpeg, detections=[]).status_code == 422
        assert frame(client, jpeg, frame_captured_at="2026-11-06T01:02:03").status_code == 422
        assert frame(client, b"not an image").status_code == 422
        local_model(client, tmp_path, monkeypatch, [Candidate(confidence=0.99, bounding_box=(1, 1, 400, 300))])
        assert frame(client, jpeg, persist=True).status_code == 422
        assert client.get("/api/stats").json()["data"]["images"] == 0
        assert list((client.app.state.storage / "media").iterdir()) == []


def test_existing_sqlite_database_gets_additive_fields_without_rewriting_records(tmp_path, jpeg):
    config = Config(data_dir=tmp_path, seed_demo=False)
    with TestClient(create_app(config)) as client:
        first = client.post("/api/upload", files={"file": ("legacy.jpg", jpeg)}).json()["data"]["detections"][0]
        assert configure(client, confidence_threshold=0.7, max_frames=17).status_code == 200
    # Recreate the pre-feature schema in isolated storage; existing rows survive.
    with sqlite3.connect(tmp_path / "turtles.sqlite3") as database:
        database.execute("ALTER TABLE runtime_settings DROP COLUMN auto_accept_enabled")
        database.execute("ALTER TABLE runtime_settings DROP COLUMN auto_accept_threshold")
        database.execute("ALTER TABLE detections DROP COLUMN review_method")
        database.execute("ALTER TABLE detections DROP COLUMN auto_accept_threshold")
    for _ in range(2):  # A second startup also verifies migration idempotence.
        with TestClient(create_app(config)) as client:
            settings = client.get("/api/settings").json()["data"]
            assert settings["confidence_threshold"] == 0.7 and settings["max_frames"] == 17
            assert settings["auto_accept_enabled"] is False and settings["auto_accept_threshold"] == 0.95
            legacy = client.get(f"/api/detections/{first['id']}").json()["data"]
            assert legacy["status"] == "pending" and legacy["review_method"] is None
            assert legacy["captured_at"] is None
            with client.app.state.sessions() as session:
                assert len(session.scalars(select(CapturedImage)).all()) == len(session.scalars(select(Detection)).all()) == 1


def test_video_policy_uses_its_queued_selection_snapshot(client, jpeg, tmp_path, monkeypatch):
    import cv2
    import numpy as np

    calls = local_model(client, tmp_path, monkeypatch, [candidate()])
    assert configure(client, auto_accept_enabled=True, auto_accept_threshold=0.96).status_code == 200
    video = tmp_path / "flight.avi"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"MJPG"), 10, (320, 240))
    assert writer.isOpened()
    writer.write(np.zeros((240, 320, 3), dtype=np.uint8))
    writer.release()
    response = client.post("/api/upload/video", files={"file": ("flight.avi", video.read_bytes())}, data={"max_frames": "1"})
    assert response.status_code == 202
    job = client.get(f"/api/jobs/{response.json()['data']['id']}").json()["data"]
    assert job["status"] == "completed", job
    assert job["settings_snapshot"]["auto_accept_enabled"] is True
    assert job["settings_snapshot"]["auto_accept_threshold"] == 0.96
    assert calls == [(320, 240)]
    saved = client.get("/api/sightings").json()["data"]
    assert len(saved) == 1 and saved[0]["review_method"] == "auto-confidence"
    assert saved[0]["auto_accept_threshold"] == 0.96
