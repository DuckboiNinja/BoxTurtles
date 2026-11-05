"""Model adapters do not depend on the database, HTTP routes, or drone hardware."""
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Protocol

from PIL import Image

from .schemas import Candidate


class Detector(Protocol):
    def predict(self, image: Image.Image, threshold: float) -> list[Candidate]: ...


class DemoDetector:
    """Deterministic fixture output; deliberately makes no claim about image content."""
    def predict(self, image, threshold):
        w, h = image.size
        candidate = Candidate(confidence=0.87, bounding_box=(w * 0.34, h * 0.27, w * 0.65, h * 0.73))
        return [candidate] if candidate.confidence >= threshold else []


class YoloDetector:
    def __init__(self, path: Path, labels: list[str]):
        if not path.is_file() or path.suffix.lower() != ".pt":
            raise ValueError("Select an existing local .pt file. Model downloads are disabled.")
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise ValueError("Install requirements-yolo.txt to enable local YOLO inference; demo mode remains available.") from exc
        self.labels = {label.casefold().strip() for label in labels}
        self.model = YOLO(str(path), task="detect")
        self.lock = RLock()

    def predict(self, image, threshold):
        with self.lock:
            results = self.model.predict(source=image, conf=threshold, device="cpu", verbose=False, save=False)
            candidates = []
            for result in results:
                if result.boxes is None:
                    continue
                for box in result.boxes:
                    label = result.names[int(box.cls.item())]
                    if self.labels and label.casefold() not in self.labels:
                        continue
                    candidates.append(Candidate(class_name=label, confidence=float(box.conf.item()), bounding_box=tuple(box.xyxy[0].tolist())))
            return candidates


@dataclass(frozen=True)
class EngineSelection:
    model_id: str
    model_name: str
    threshold: float
    is_mock: bool
    detector: Detector


class EngineRegistry:
    def __init__(self):
        self.cache = {}
        self.lock = RLock()

    def select(self, session, settings):
        from .db import DetectionModel
        if settings.active_model_id == "demo":
            return EngineSelection("demo", "Demo simulator", settings.confidence_threshold, True, DemoDetector())
        record = session.get(DetectionModel, settings.active_model_id)
        if record is None:
            raise ValueError("The active model is no longer registered. Choose a model in Settings.")
        path = Path(record.path).expanduser().resolve()
        if not path.is_file():
            raise ValueError("The active model file is missing. Update Settings or switch to demo mode.")
        key = (str(path), path.stat().st_mtime_ns, tuple(record.labels))
        with self.lock:
            if key not in self.cache:
                adapter = YoloDetector(path, record.labels)
                self.cache.clear()  # Keep one loaded model to bound CPU memory.
                self.cache[key] = adapter
            return EngineSelection(record.id, record.name, settings.confidence_threshold, False, self.cache[key])
