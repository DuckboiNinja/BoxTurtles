import math
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class Metadata(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    captured_at: datetime | None = None

    @model_validator(mode="after")
    def pair_coordinates(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Supply both latitude and longitude, or leave both empty.")
        return self


class Candidate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    class_name: str = Field(default="turtle", min_length=1, max_length=100)
    confidence: float = Field(ge=0, le=1)
    bounding_box: tuple[float, float, float, float]

    @field_validator("bounding_box")
    @classmethod
    def valid_box(cls, value):
        x1, y1, x2, y2 = value
        if not all(math.isfinite(x) for x in value) or x1 < 0 or y1 < 0 or x2 <= x1 or y2 <= y1:
            raise ValueError("Bounding boxes must be finite pixel [x1, y1, x2, y2] coordinates with positive area.")
        return value


class IngestEnvelope(BaseModel):
    """Stable contract for uploads, prerecorded frames, ROS bridges and future streams."""
    model_config = ConfigDict(extra="forbid")
    source: str = Field(default="external-frame", min_length=1, max_length=100)
    metadata: Metadata = Field(default_factory=Metadata)
    # Measured at snapshot time by the browser, never inferred by the server.
    frame_captured_at: AwareDatetime | None = None
    # null runs the active engine; [] means the upstream detector found nothing.
    detections: list[Candidate] | None = Field(default=None, max_length=500)
    model_id: str = Field(default="external", max_length=100)
    model_name: str = Field(default="External detector", max_length=200)
    is_mock: bool = False

    @model_validator(mode="after")
    def live_frame_timestamp_source(self):
        if self.frame_captured_at is not None and self.source != "scrcpy-window":
            raise ValueError("frame_captured_at is supported only for the scrcpy-window source.")
        return self


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    active_model_id: str
    confidence_threshold: float = Field(ge=0.01, le=1)
    frame_interval_seconds: float = Field(ge=0.25, le=3600)
    max_frames: int = Field(ge=1, le=1000)


class ModelRegistration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    path: str = Field(min_length=1, max_length=2000)
    labels: list[str] = Field(default_factory=lambda: ["turtle"], max_length=100)


class ReviewStatus(BaseModel):
    status: Literal["pending", "verified", "rejected"]


class RejectedPhotoDeletion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    image_ids: list[UUID] = Field(min_length=1, max_length=1000)
