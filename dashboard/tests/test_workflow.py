import json
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from backend.app.config import Config
from backend.app.db import CapturedImage, Detection, RuntimeSettings
from backend.app.main import create_app
from backend.app.metadata import exif_metadata, match_telemetry, read_telemetry


@pytest.fixture
def client(tmp_path):
    app = create_app(Config(data_dir=tmp_path, seed_demo=False))
    with TestClient(app) as connection:
        yield connection


@pytest.fixture
def jpeg():
    stream = BytesIO()
    Image.new("RGB", (320, 240), "#536e39").save(stream, "JPEG")
    return stream.getvalue()


def upload(client, jpeg, metadata=None):
    return client.post("/api/upload", files={"file": ("survey.jpg", jpeg, "image/jpeg")}, data={"metadata": json.dumps(metadata or {})})


def settings(client, **overrides):
    payload = client.get("/api/settings").json()["data"] | overrides
    return client.put("/api/settings", json=payload)


def test_review_is_atomic_and_preserves_original_records(client, jpeg):
    response = upload(client, jpeg, {"latitude": 35.9, "longitude": -78.9, "captured_at": "2024-06-01T10:00:00-04:00"})
    assert response.status_code == 201
    item = response.json()["data"]["detections"][0]
    path = f"/api/detections/{item['id']}"
    verified = client.post(f"{path}/verify").json()["data"]
    assert verified["status"] == "verified"
    assert verified["captured_at"] == "2024-06-01T10:00:00-04:00"
    assert verified["original_url"] == item["original_url"]
    assert verified["reviewed_at"] != verified["captured_at"]
    assert client.post(f"{path}/verify").status_code == 409
    assert client.post(f"{path}/reject").status_code == 409
    assert client.get("/api/sightings").json()["total"] == 1
    assert client.post(f"{path}/reset").json()["data"]["reviewed_at"] is None
    assert client.post(f"{path}/reset").status_code == 409
    assert client.post(f"{path}/reject").status_code == 200
    assert client.get("/api/sightings").json()["total"] == 0
    assert client.get("/api/detections?status=rejected").json()["total"] == 1
    assert client.get(item["original_url"]).status_code == 200
    with client.app.state.sessions() as session:
        assert len(session.scalars(select(CapturedImage)).all()) == 1
        assert len(session.scalars(select(Detection)).all()) == 1


def test_missing_metadata_and_mock_results_are_explicit(client, jpeg):
    item = upload(client, jpeg).json()["data"]["detections"][0]
    assert item["latitude"] is None and item["longitude"] is None and item["captured_at"] is None
    assert item["metadata"]["missing"] == ["gps", "captured_at"]
    assert item["is_mock"] is True and item["is_demo"] is False
    assert item["uploaded_at"]
    assert (client.app.state.storage / "media" / item["image_id"] / "source.bin").read_bytes() == jpeg


def test_threshold_changes_only_future_results(client, jpeg):
    assert upload(client, jpeg).json()["data"]["detections"]
    assert settings(client, confidence_threshold=0.95).status_code == 200
    assert upload(client, jpeg).json()["data"]["detections"] == []
    assert client.get("/api/stats").json()["data"]["total"] == 1
    assert client.get("/api/stats").json()["data"]["images"] == 2


def test_external_interface_multiple_candidates_share_one_image(client, jpeg):
    envelope = {"source": "future-ros-bridge", "metadata": {"latitude": 0, "longitude": 0, "captured_at": "2023-01-01T12:00:00Z"},
                "model_id": "custom-v4", "model_name": "Future model", "detections": [
                    {"bounding_box": [10, 10, 80, 90], "confidence": 0.91},
                    {"bounding_box": [100, 60, 220, 150], "confidence": 0.82}]}
    response = client.post("/api/ingest/frame", files={"file": ("frame.jpg", jpeg)}, data={"envelope": json.dumps(envelope)})
    assert response.status_code == 201
    candidates = response.json()["data"]["detections"]
    assert len(candidates) == 2
    assert candidates[0]["image_id"] == candidates[1]["image_id"]
    assert candidates[0]["cropped_url"] != candidates[1]["cropped_url"]
    assert candidates[0]["latitude"] == 0 and candidates[0]["is_mock"] is False
    client.post(f"/api/detections/{candidates[0]['id']}/verify")
    assert client.get(f"/api/detections/{candidates[1]['id']}").json()["data"]["status"] == "pending"


@pytest.mark.parametrize("local_model", [False, True], ids=["demo", "local-model"])
def test_scrcpy_frames_use_active_engine_and_preserve_unknown_capture_metadata(client, jpeg, tmp_path, monkeypatch, local_model):
    from backend.app import engine
    from backend.app.schemas import Candidate

    expected_model = "demo"
    if local_model:
        class LocalDetector:
            def __init__(self, path, labels):
                pass

            def predict(self, image, threshold):
                assert image.size == (320, 240)
                return [Candidate(confidence=0.94, bounding_box=(10, 20, 80, 90))]

        monkeypatch.setattr(engine, "YoloDetector", LocalDetector)
        path = tmp_path / "scrcpy-test-model.pt"
        path.write_bytes(b"local adapter fixture; no Ultralytics required")
        registered = client.post("/api/models", json={"name": "Local turtle detector", "path": str(path)})
        assert registered.status_code == 201
        expected_model = registered.json()["data"]["id"]
        assert settings(client, active_model_id=expected_model).status_code == 200

    response = client.post("/api/ingest/frame", files={"file": ("scrcpy-frame-1.jpg", jpeg, "image/jpeg")},
                           data={"envelope": json.dumps({"source": "scrcpy-window", "metadata": {}})})
    assert response.status_code == 201
    result = response.json()["data"]
    assert result["metadata"]["missing"] == ["gps", "captured_at"]
    assert result["metadata"]["provenance"] == {}
    assert len(result["detections"]) == 1
    item = result["detections"][0]
    assert item["source"] == "scrcpy-window"
    assert item["model_id"] == expected_model
    assert item["is_mock"] is (not local_model)
    assert item["is_demo"] is False
    assert item["status"] == "pending"
    assert item["latitude"] is None and item["longitude"] is None and item["captured_at"] is None
    assert item["uploaded_at"] and item["created_at"]
    folder = client.app.state.storage / "media" / result["image_id"]
    assert (folder / "source.bin").read_bytes() == jpeg
    assert client.get(item["original_url"]).status_code == 200
    assert client.post(f"/api/detections/{item['id']}/reject").status_code == 200
    retained = client.get(f"/api/detections/{item['id']}").json()["data"]
    assert retained["status"] == "rejected" and retained["source"] == "scrcpy-window"
    assert (folder / "source.bin").read_bytes() == jpeg


def test_empty_external_candidates_does_not_run_engine(client, jpeg):
    result = client.post("/api/ingest/frame", files={"file": ("frame.jpg", jpeg)}, data={"envelope": '{"detections":[]}'}).json()["data"]
    assert result["detections"] == []


@pytest.mark.parametrize("envelope", [
    {"detections": [{"confidence": 1.1, "bounding_box": [0, 0, 20, 20]}]},
    {"detections": [{"confidence": 0.8, "bounding_box": [0, 0, 900, 20]}]},
    {"detections": [{"confidence": 0.8, "bounding_box": [20, 0, 10, 20]}]},
    {"metadata": {"latitude": 95, "longitude": 4}},
    {"metadata": {"latitude": 30}},
    {"metadata": {"latitude": float("nan"), "longitude": 4}},
])
def test_ingestion_validation_does_not_create_records(client, jpeg, envelope):
    response = client.post("/api/ingest/frame", files={"file": ("frame.jpg", jpeg)}, data={"envelope": json.dumps(envelope)})
    assert response.status_code == 422
    assert "error" in response.json()
    assert client.get("/api/stats").json()["data"]["images"] == 0


def test_bad_files_and_missing_resources(client):
    assert upload(client, b"not an image").status_code == 422
    assert client.get("/api/detections/no-such-id").status_code == 404
    assert client.post("/api/detections/no-such-id/verify").status_code == 404
    assert client.get("/api/detections?status=bogus").status_code == 422
    assert client.get("/api/jobs/no-such-id").status_code == 404
    assert settings(client, confidence_threshold=1.1).status_code == 422
    assert settings(client, active_model_id="missing-model").status_code == 422


def test_unknown_api_routes_return_json_instead_of_spa_html(client):
    for route in ["/api", "/api/does-not-exist"]:
        response = client.get(route)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == 404


def test_live_source_configuration_is_persistent_and_does_not_claim_connectivity(tmp_path):
    config = Config(data_dir=tmp_path, seed_demo=False)
    with TestClient(create_app(config)) as client:
        initial = client.get("/api/live-source").json()["data"]
        assert initial["playback_url"] == "" and initial["live_inference_enabled"] is False
        saved = client.put("/api/live-source", json={"playback_url": "http://127.0.0.1:8889/turtle", "transport": "webrtc"})
        assert saved.status_code == 200
        assert saved.json()["data"]["drone_connection_verified"] is False
    with TestClient(create_app(config)) as client:
        assert client.get("/api/live-source").json()["data"]["playback_url"] == "http://127.0.0.1:8889/turtle"
        assert client.get("/api/stats").json()["data"]["total"] == 0


@pytest.mark.parametrize("url", ["rtsp://127.0.0.1:8554/turtle", "javascript:alert(1)", "http://127.0.0.1:8889", "http://user:password@127.0.0.1:8889/turtle", "http://127.0.0.1:8888/turtle/index.m3u8", "http://127.0.0.1:8889/turtle/whep"])
def test_live_source_rejects_nonplayer_urls_and_embedded_credentials(client, url):
    response = client.put("/api/live-source", json={"playback_url": url, "transport": "webrtc"})
    assert response.status_code == 422
    assert client.get("/api/live-source").json()["data"]["playback_url"] == ""


def test_ingestion_auth_when_configured(tmp_path, jpeg):
    app = create_app(Config(data_dir=tmp_path, seed_demo=False, ingest_token="test-token"))
    with TestClient(app) as client:
        assert client.post("/api/ingest/frame", files={"file": ("frame.jpg", jpeg)}).status_code == 401
        assert client.post("/api/ingest/frame", files={"file": ("frame.jpg", jpeg)}, headers={"X-Ingest-Token": "test-token"}).status_code == 201


def test_model_swaps_do_not_change_detection_schema(client, jpeg, tmp_path, monkeypatch):
    from backend.app import engine
    from backend.app.schemas import Candidate
    class FakeYolo:
        def __init__(self, path, labels):
            self.path = path
        def predict(self, image, threshold):
            return [Candidate(confidence=0.99, bounding_box=(10, 10, 50, 60))]
    monkeypatch.setattr(engine, "YoloDetector", FakeYolo)
    initial = upload(client, jpeg).json()["data"]["detections"][0]
    for version in [1, 2]:
        path = tmp_path / f"turtle-v{version}.pt"
        path.write_bytes(b"test adapter fixture")
        registered = client.post("/api/models", json={"name": f"Turtle v{version}", "path": str(path), "labels": ["turtle"]})
        assert registered.status_code == 201
        model_id = registered.json()["data"]["id"]
        assert settings(client, active_model_id=model_id).status_code == 200
        current = upload(client, jpeg).json()["data"]["detections"][0]
        assert set(current) == set(initial)
        assert current["model_id"] == model_id and current["is_mock"] is False
    assert client.get(f"/api/detections/{initial['id']}").json()["data"]["model_id"] == "demo"


def test_model_path_is_local_and_existing(client, tmp_path):
    assert client.post("/api/models", json={"name": "missing", "path": str(tmp_path / "missing.pt")}).status_code == 422
    assert client.post("/api/models", json={"name": "url", "path": "https://example.com/model.pt"}).status_code == 422


def test_exif_timestamp_keeps_original_timezone_and_manual_override(client):
    image = Image.new("RGB", (80, 60), "green")
    exif = Image.Exif(); exif[36867] = "2020:08:12 11:15:30"; exif[36881] = "+03:00"
    buffer = BytesIO(); image.save(buffer, "JPEG", exif=exif)
    item = upload(client, buffer.getvalue()).json()["data"]["detections"][0]
    assert item["captured_at"] == "2020-08-12T11:15:30+03:00"
    changed = upload(client, buffer.getvalue(), {"captured_at": "2019-01-01T00:00:00Z"}).json()["data"]["detections"][0]
    assert changed["captured_at"] == "2019-01-01T00:00:00+00:00"
    assert changed["metadata"]["provenance"]["captured_at"] == "manual"


def test_exif_gps_and_orientation_are_preserved(client):
    image = Image.new("RGB", (80, 60), "green")
    exif = Image.Exif(); exif[274] = 6
    exif[34853] = {1: "N", 2: (35.0, 30.0, 0.0), 3: "W", 4: (78.0, 45.0, 0.0)}
    buffer = BytesIO(); image.save(buffer, "JPEG", exif=exif)
    item = upload(client, buffer.getvalue()).json()["data"]["detections"][0]
    assert item["latitude"] == 35.5 and item["longitude"] == -78.75
    assert (item["width"], item["height"]) == (60, 80)
    assert item["metadata"]["provenance"]["gps"] == "EXIF GPS"


@pytest.mark.parametrize("references", [{}, {1: "N"}, {1: "X", 3: "W"}])
def test_exif_gps_without_valid_hemispheres_remains_unknown(client, references):
    image = Image.new("RGB", (80, 60), "green")
    exif = Image.Exif()
    exif[34853] = {2: (35.0, 30.0, 0.0), 4: (78.0, 45.0, 0.0)} | references
    buffer = BytesIO(); image.save(buffer, "JPEG", exif=exif)
    response = upload(client, buffer.getvalue())
    assert response.status_code == 201
    item = response.json()["data"]["detections"][0]
    assert item["latitude"] is None and item["longitude"] is None
    assert "gps" in item["metadata"]["missing"]
    assert "gps" not in item["metadata"]["provenance"]
    assert any("GPS" in warning for warning in item["metadata"]["warnings"])


def test_truncated_telemetry_csv_returns_validation_error(client):
    response = client.post("/api/upload/video", files={
        "file": ("flight.avi", b"not decoded because metadata is invalid"),
        "telemetry": ("flight.csv", b"offset_seconds,latitude,longitude\n0,35\n")})
    assert response.status_code == 422
    assert "Invalid telemetry CSV row 2" in response.json()["error"]["message"]
    assert client.get("/api/jobs").json()["data"] == []
    assert client.get("/api/stats").json()["data"]["images"] == 0
    point = read_telemetry(b"offset_seconds,latitude,longitude,captured_at\n0,35,-78\n", "flight.csv")[0]
    assert point.metadata.latitude == 35 and point.metadata.longitude == -78
    assert point.metadata.captured_at is None


def test_telemetry_csv_and_srt_have_bounded_time_matching():
    csv = b"offset_seconds,latitude,longitude,captured_at\n0,35,-78,2024-01-01T00:00:00Z\n4,36,-79,2024-01-01T00:00:04Z\n"
    points = read_telemetry(csv, "track.csv")
    assert match_telemetry(points, 3.5, 1).latitude == 36
    assert match_telemetry(points, 3.5, 1).captured_at == "2024-01-01T00:00:03.500000+00:00"
    assert match_telemetry(points, 8, 1).latitude is None
    srt = b"1\n00:00:01,000 --> 00:00:02,000\n2024.01.01 12:00:01 [latitude: 35.5] [longitude: -78.5]\n"
    point = read_telemetry(srt, "drone.srt")[0]
    assert point.offset_seconds == 1 and point.metadata.longitude == -78.5
    assert point.metadata.captured_at == "2024-01-01T12:00:01"
    assert any("timezone" in x for x in point.metadata.info()["warnings"])
    with pytest.raises(ValueError):
        read_telemetry(b"offset_seconds,latitude,longitude\n0,35,\n", "track.csv")
    with pytest.raises(ValueError):
        read_telemetry(b"offset_seconds\nNaN\n", "track.csv")


def make_video(path):
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (80, 60))
    assert writer.isOpened()
    for index in range(30):
        writer.write(np.full((60, 80, 3), index * 6, dtype=np.uint8))
    writer.release()


def test_actual_video_frame_sampling_and_telemetry(client, tmp_path):
    path = tmp_path / "flight.avi"; make_video(path)
    response = client.post("/api/upload/video", files={
        "file": ("flight.avi", path.read_bytes(), "video/x-msvideo"),
        "telemetry": ("flight.csv", b"offset_seconds,latitude,longitude,captured_at\n0,35,-78,2024-01-01T00:00:00Z\n1,35.1,-78.1,2024-01-01T00:00:01Z\n")},
        data={"frame_interval_seconds": "1", "max_frames": "2"})
    assert response.status_code == 202
    job_id = response.json()["data"]["id"]
    job = client.get(f"/api/jobs/{job_id}").json()["data"]
    assert job["status"] == "completed", job
    assert job["processed_frames"] == job["total_frames"] == 2
    assert job["detections_created"] == 2
    assert job["settings_snapshot"]["is_mock"] is True
    detections = client.get("/api/detections").json()["data"]
    assert {x["captured_at"] for x in detections} == {"2024-01-01T00:00:00+00:00", "2024-01-01T00:00:01+00:00"}
    assert {x["latitude"] for x in detections} == {35, 35.1}
    assert any("Frame limit" in warning for warning in job["warnings"])


def test_video_without_metadata_does_not_invent_time(client, tmp_path):
    path = tmp_path / "flight.avi"; make_video(path)
    response = client.post("/api/upload/video", files={"file": ("flight.avi", path.read_bytes())}, data={"max_frames": "1"})
    job = client.get(f"/api/jobs/{response.json()['data']['id']}").json()["data"]
    assert job["status"] == "completed"
    item = client.get("/api/detections").json()["data"][0]
    assert item["captured_at"] is None and item["latitude"] is None


def test_corrupt_video_reports_failed_job(client):
    response = client.post("/api/upload/video", files={"file": ("broken.mp4", b"not a video")})
    assert response.status_code == 202
    job = client.get(f"/api/jobs/{response.json()['data']['id']}").json()["data"]
    assert job["status"] == "failed" and job["error"]
    assert client.get("/api/stats").json()["data"]["total"] == 0


def test_demo_is_idempotent_and_persists_reviews(tmp_path):
    config = Config(data_dir=tmp_path, seed_demo=True)
    with TestClient(create_app(config)) as client:
        pending = client.get("/api/detections?status=pending").json()["data"]
        assert len(pending) == 7 and all(x["is_mock"] and x["is_demo"] for x in pending)
        chosen = pending[0]["id"]
        client.post(f"/api/detections/{chosen}/verify")
        assert settings(client, confidence_threshold=0.75).status_code == 200
    with TestClient(create_app(config)) as client:
        assert client.get("/api/stats").json()["data"]["total"] == 12
        assert client.get(f"/api/detections/{chosen}").json()["data"]["status"] == "verified"
        assert client.get("/api/settings").json()["data"]["confidence_threshold"] == 0.75
