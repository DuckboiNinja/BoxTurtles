import json
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.config import Config
from backend.app.db import CapturedImage, Detection
from backend.app.main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Config(data_dir=tmp_path, seed_demo=False))) as connection:
        yield connection


def photo(client, *, candidates=1):
    stream = BytesIO()
    Image.new("RGB", (320, 240), "#536e39").save(stream, "JPEG")
    response = client.post("/api/ingest/frame", files={"file": ("deletion-test.jpg", stream.getvalue(), "image/jpeg")}, data={
        "envelope": json.dumps({"source": "synthetic-deletion-test", "is_mock": True, "metadata": {},
                                "detections": [{"confidence": .9, "bounding_box": [10, 10, 80, 90]}] * candidates})})
    assert response.status_code == 201
    return response.json()["data"]


def reject(client, result):
    for item in result["detections"]:
        assert client.post(f"/api/detections/{item['id']}/reject").status_code == 200


def snapshot(client):
    media = client.app.state.storage / "media"
    return {str(path.relative_to(media)): path.read_bytes() for path in media.rglob("*") if path.is_file()}


def delete_photos(client, *image_ids):
    return client.post("/api/images/delete-rejected", json={"image_ids": image_ids})


def test_deletion_removes_complete_rejected_photos_and_preserves_survivors_and_videos(client):
    first, second, survivor = photo(client, candidates=2), photo(client), photo(client)
    reject(client, first)
    reject(client, second)
    survivor_before = client.get(f"/api/detections/{survivor['detections'][0]['id']}").json()["data"]
    video = client.app.state.storage / "videos" / "original-recording.mp4"
    video.write_bytes(b"retained original recording")
    response = delete_photos(client, first["image_id"], second["image_id"], first["image_id"])
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["deleted_image_ids"] == [first["image_id"], second["image_id"]]
    assert set(data["deleted_detection_ids"]) == {item["id"] for result in (first, second) for item in result["detections"]}
    assert data["deleted_photos"] == 2 and data["cleanup_pending"] is False
    for result in (first, second):
        assert not (client.app.state.storage / "media" / result["image_id"]).exists()
        for item in result["detections"]:
            assert client.get(f"/api/detections/{item['id']}").status_code == 404
            assert client.get(item["original_url"]).status_code == 404
    assert client.get(f"/api/detections/{survivor_before['id']}").json()["data"] == survivor_before
    assert client.get(survivor_before["original_url"]).status_code == 200
    assert (client.app.state.storage / "media" / survivor["image_id"] / "source.bin").exists()
    assert video.read_bytes() == b"retained original recording"
    assert client.get("/api/stats").json()["data"]["images"] == 1
    assert delete_photos(client, first["image_id"]).status_code == 404


@pytest.mark.parametrize("sibling_status", ["pending", "verified"])
def test_deletion_refuses_the_whole_batch_if_a_photo_has_unrejected_siblings(client, sibling_status):
    safe = photo(client)
    shared = photo(client, candidates=2)
    reject(client, safe)
    assert client.post(f"/api/detections/{shared['detections'][0]['id']}/reject").status_code == 200
    if sibling_status == "verified":
        assert client.post(f"/api/detections/{shared['detections'][1]['id']}/verify").status_code == 200
    before = snapshot(client)
    response = delete_photos(client, safe["image_id"], shared["image_id"])
    assert response.status_code == 409
    assert snapshot(client) == before
    assert client.get("/api/detections").json()["total"] == 3


def test_deletion_requires_existing_ids_and_rechecks_review_status(client):
    item = photo(client)
    reject(client, item)
    before = snapshot(client)
    assert delete_photos(client, item["image_id"], str(uuid4())).status_code == 404
    assert snapshot(client) == before
    assert client.post(f"/api/detections/{item['detections'][0]['id']}/reset").status_code == 200
    assert delete_photos(client, item["image_id"]).status_code == 409
    assert snapshot(client) == before


@pytest.mark.parametrize("payload", [{"image_ids": []}, {"image_ids": ["../outside"]}, {"image_ids": [str(uuid4())] * 1001}, {"image_ids": [str(uuid4())], "confirm_all": True}])
def test_deletion_validates_bounded_explicit_selection(client, payload):
    assert client.post("/api/images/delete-rejected", json=payload).status_code == 422


def test_deletion_refuses_unsafe_media_paths_without_touching_any_files(client):
    item = photo(client)
    reject(client, item)
    outside = client.app.state.storage / "outside.txt"
    outside.write_bytes(b"keep this")
    before = snapshot(client)
    with client.app.state.sessions() as session:
        session.get(CapturedImage, item["image_id"]).original_image_path = "../outside.txt"
        session.commit()
    assert delete_photos(client, item["image_id"]).status_code == 409
    assert outside.read_bytes() == b"keep this"
    assert snapshot(client) == before
    with client.app.state.sessions() as session:
        assert session.get(CapturedImage, item["image_id"]) is not None


def test_deletion_preserves_media_paths_shared_with_surviving_records(client):
    item, survivor = photo(client), photo(client)
    reject(client, item)
    original = item["detections"][0]
    with client.app.state.sessions() as session:
        source_image = session.get(CapturedImage, item["image_id"])
        source_detection = session.get(Detection, original["id"])
        session.get(CapturedImage, survivor["image_id"]).original_image_path = source_image.original_image_path
        target = session.get(Detection, survivor["detections"][0]["id"])
        target.cropped_image_path = source_detection.cropped_image_path
        target.annotated_image_path = source_detection.annotated_image_path
        session.commit()
    before = snapshot(client)
    assert delete_photos(client, item["image_id"]).status_code == 200
    assert snapshot(client) == before
    for name in ("original_url", "cropped_url", "annotated_url"):
        assert client.get(original[name]).status_code == 200
    assert client.get(f"/api/detections/{survivor['detections'][0]['id']}").status_code == 200


def test_deletion_restores_files_and_rows_if_a_media_move_fails(client, monkeypatch):
    from backend.app import deletion
    item = photo(client)
    reject(client, item)
    before = snapshot(client)
    move = deletion._move_file
    attempts = 0

    def fail_second_move(source, destination):
        nonlocal attempts
        attempts += 1
        if attempts == 2:
            raise PermissionError("Simulated locked file")
        return move(source, destination)

    monkeypatch.setattr(deletion, "_move_file", fail_second_move)
    assert delete_photos(client, item["image_id"]).status_code == 500
    assert snapshot(client) == before
    assert client.get(f"/api/detections/{item['detections'][0]['id']}").json()["data"]["status"] == "rejected"
    assert not any((client.app.state.storage / ".deletion-staging").rglob("*"))


def test_deletion_restores_files_and_rows_if_the_database_commit_fails(client, monkeypatch):
    item = photo(client)
    reject(client, item)
    before = snapshot(client)

    def fail_commit(_):
        raise RuntimeError("Simulated database commit failure")

    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", fail_commit)
        assert delete_photos(client, item["image_id"]).status_code == 500
    assert snapshot(client) == before
    assert client.get(f"/api/detections/{item['detections'][0]['id']}").json()["data"]["status"] == "rejected"
    with client.app.state.sessions() as session:
        assert session.get(CapturedImage, item["image_id"]) is not None
        assert len(session.scalars(select(Detection)).all()) == 1


def test_a_cleanup_failure_reports_pending_cleanup_after_removing_public_media(client, monkeypatch):
    item = photo(client)
    reject(client, item)
    unlink = Path.unlink

    def fail_staged_unlink(path, *args, **kwargs):
        if path.parent.parent.name == ".deletion-staging":
            raise PermissionError("Simulated locked cleanup")
        return unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_staged_unlink)
    response = delete_photos(client, item["image_id"])
    assert response.status_code == 200
    assert response.json()["data"]["cleanup_pending"] is True
    assert client.get(item["detections"][0]["original_url"]).status_code == 404
    assert client.get(f"/api/detections/{item['detections'][0]['id']}").status_code == 404
    manifests = list((client.app.state.storage / ".deletion-staging").glob("*/manifest.json"))
    assert len(manifests) == 1
    manifest = json.loads(manifests[0].read_text(encoding="utf-8"))
    assert manifest["image_ids"] == [item["image_id"]]
    original_path = item["detections"][0]["original_url"].removeprefix("/media/")
    assert original_path in {entry["media_relative_path"] for entry in manifest["files"]}
    for entry in manifest["files"]:
        assert entry["staged_name"].isdigit()
        assert not Path(entry["media_relative_path"]).is_absolute()
        assert ".." not in Path(entry["media_relative_path"]).parts
        assert (manifests[0].parent / entry["staged_name"]).is_file()
