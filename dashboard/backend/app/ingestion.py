from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError

from .db import CapturedImage, Detection, ProcessingJob, now, uid
from .metadata import CaptureMetadata, exif_metadata, match_telemetry, supplied, video_metadata
from .schemas import Candidate, Metadata


def decode_image(content: bytes):
    try:
        image = Image.open(BytesIO(content))
        if image.width * image.height > 40_000_000:
            raise ValueError("Image exceeds the 40 megapixel limit.")
        embedded = exif_metadata(image)
        image.load()
        # All boxes use the displayed, EXIF-oriented pixel coordinate system.
        return ImageOps.exif_transpose(image).convert("RGB"), embedded
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("The uploaded file is not a supported, decodable image.") from exc


def save_frame(session, storage: Path, image: Image.Image, filename: str, source: str, metadata: CaptureMetadata,
               selection=None, candidates: list[Candidate] | None = None, model_id="external", model_name="External detector", is_mock=False,
               is_demo=False, original_bytes: bytes | None = None):
    if candidates is None:
        if selection is None:
            raise ValueError("A detection engine is required.")
        candidates = selection.detector.predict(image, selection.threshold)
        model_id, model_name, is_mock = selection.model_id, selection.model_name, selection.is_mock
    # Reject upstream invalid boxes instead of silently misaligning crops or annotations.
    for candidate in candidates:
        if candidate.bounding_box[2] > image.width or candidate.bounding_box[3] > image.height:
            raise ValueError("Bounding box is outside the EXIF-oriented image dimensions.")
    image_id = uid()
    folder = storage / "media" / image_id
    folder.mkdir(parents=True, exist_ok=True)
    saved_files = []
    try:
        original = f"{image_id}/original.jpg"
        image.save(folder / "original.jpg", quality=94)
        saved_files.append(folder / "original.jpg")
        if original_bytes is not None:
            # Keep the exact upload for EXIF, provenance and future reprocessing.
            (folder / "source.bin").write_bytes(original_bytes)
            saved_files.append(folder / "source.bin")
        record = CapturedImage(id=image_id, original_image_path=original, filename=filename, width=image.width, height=image.height,
                               source=source, latitude=metadata.latitude, longitude=metadata.longitude, captured_at=metadata.captured_at,
                               is_demo=is_demo, metadata_info=metadata.info())
        session.add(record)
        session.flush()
        created = []
        for candidate in candidates:
            detection_id = uid()
            x1, y1, x2, y2 = candidate.bounding_box
            # Pillow crop bounds must stay non-empty even for subpixel predictions.
            import math
            crop = image.crop((math.floor(x1), math.floor(y1), math.ceil(x2), math.ceil(y2)))
            crop_path = folder / f"{detection_id}-crop.jpg"
            crop.save(crop_path, quality=94)
            saved_files.append(crop_path)
            annotated = image.copy()
            draw = ImageDraw.Draw(annotated)
            draw.rectangle((x1, y1, x2, y2), outline="#6ce3ac", width=max(2, image.width // 250))
            draw.text((x1 + 5, max(0, y1 - 16)), f"{candidate.class_name} {candidate.confidence:.0%}", fill="#6ce3ac")
            annotation_path = folder / f"{detection_id}-annotated.jpg"
            annotated.save(annotation_path, quality=93)
            saved_files.append(annotation_path)
            detection = Detection(id=detection_id, image_id=image_id, class_name=candidate.class_name, confidence=candidate.confidence,
                                  bounding_box=list(candidate.bounding_box), cropped_image_path=f"{image_id}/{crop_path.name}",
                                  annotated_image_path=f"{image_id}/{annotation_path.name}", model_id=model_id, model_name=model_name, is_mock=is_mock)
            session.add(detection)
            created.append(detection)
        session.commit()
        return record, created
    except Exception:
        session.rollback()
        for path in saved_files:
            path.unlink(missing_ok=True)
        if folder.exists() and not any(folder.iterdir()):
            folder.rmdir()
        raise


def process_video(app, job_id, path, manual: Metadata, telemetry, selection, interval, max_frames):
    import cv2
    cap = None
    with app.state.sessions() as session:
        job = session.get(ProcessingJob, job_id)
        try:
            job.status = "processing"
            session.commit()
            cap = cv2.VideoCapture(str(path))
            if not cap.isOpened():
                raise ValueError("Cannot decode this video. Export DJI footage to a supported MP4/MOV codec (H.264 is recommended).")
            fps, count = cap.get(cv2.CAP_PROP_FPS), cap.get(cv2.CAP_PROP_FRAME_COUNT)
            if not fps or fps <= 0 or not count or count <= 0:
                raise ValueError("Video has no readable frame count or frame rate.")
            step = max(1, round(interval * fps))
            indices = list(range(0, int(count), step))[:max_frames]
            job.total_frames = len(indices)
            base = video_metadata(path).apply(supplied(manual))
            warnings = list(base.warnings)
            if (int(count) + step - 1) // step > max_frames:
                warnings.append(f"Frame limit reached: only the first {max_frames} sampled frames are selected.")
            session.commit()
            for index in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, index)
                ok, pixels = cap.read()
                if not ok:
                    warnings.append(f"Could not decode frame {index}.")
                    continue
                # Derive time from the actual frame index, never from upload time.
                seconds = index / fps
                metadata = CaptureMetadata(base.latitude, base.longitude, base.captured_at, dict(base.provenance), list(base.warnings))
                if metadata.captured_at:
                    metadata.captured_at = (datetime.fromisoformat(metadata.captured_at) + timedelta(seconds=seconds)).isoformat()
                metadata.apply(match_telemetry(telemetry, seconds, app.state.config.telemetry_tolerance_seconds))
                metadata.provenance["video_frame"] = {"job_id": job_id, "offset_seconds": round(seconds, 6), "frame_index": index, "fps": fps}
                _, detections = save_frame(session, app.state.storage, Image.fromarray(cv2.cvtColor(pixels, cv2.COLOR_BGR2RGB)),
                                           f"{job.filename} · frame {index}", "recorded-video", metadata, selection=selection)
                job.processed_frames += 1
                job.detections_created += len(detections)
                for warning in metadata.warnings:
                    if warning not in warnings:
                        warnings.append(warning)
                session.commit()
            if not job.processed_frames:
                raise ValueError("None of the selected frames could be decoded.")
            job.warnings = list(dict.fromkeys(warnings))
            job.status = "completed"
        except Exception as exc:
            session.rollback()
            job = session.get(ProcessingJob, job_id)
            job.status = "failed"
            job.error = str(exc)
        finally:
            if cap is not None:
                cap.release()
            job.finished_at = now()
            session.commit()
            # Recorded input is retained under data/videos for reprocessing.
