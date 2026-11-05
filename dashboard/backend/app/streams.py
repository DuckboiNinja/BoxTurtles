"""Media relay configuration. Playback never implies a verified drone connection."""
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class LiveSource(Base):
    __tablename__ = "live_sources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    playback_url: Mapped[str] = mapped_column(String, default="")
    transport: Mapped[str] = mapped_column(String, default="webrtc")


class LiveSourceSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    playback_url: str = Field(default="", max_length=2000)
    transport: Literal["webrtc", "hls"] = "webrtc"

    @field_validator("playback_url")
    @classmethod
    def valid_player_url(cls, value):
        value = value.strip()
        if not value:
            return ""
        try:
            parsed = urlsplit(value)
            _ = parsed.port
        except ValueError as exc:
            raise ValueError("Enter a valid MediaMTX HTTP or HTTPS player address.") from exc
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or any(char.isspace() for char in value):
            raise ValueError("Use the MediaMTX HTTP/HTTPS browser player URL; RTSP and RTMP addresses cannot play directly in a browser.")
        if parsed.username or parsed.password:
            raise ValueError("Leave credentials out of the saved URL. Sign in through the MediaMTX player when prompted.")
        if not parsed.path.strip("/"):
            raise ValueError("Include the stream path, for example http://127.0.0.1:8889/turtle.")
        if parsed.path.lower().endswith((".m3u8", "/whep")):
            raise ValueError("Use the MediaMTX browser player page, not a playlist or WHEP endpoint.")
        return value


router = APIRouter(prefix="/api/live-source", tags=["Live source"])


def response(record):
    return {"data": {"playback_url": record.playback_url, "transport": record.transport,
                     "drone_connection_verified": False, "live_inference_enabled": False}}


@router.get("")
def get_live_source(request: Request):
    with request.app.state.sessions() as session:
        record = session.get(LiveSource, 1)
        return response(record or LiveSourceSettings())


@router.put("")
def save_live_source(payload: LiveSourceSettings, request: Request):
    with request.app.state.sessions() as session:
        record = session.get(LiveSource, 1)
        if record is None:
            record = LiveSource(id=1)
            session.add(record)
        record.playback_url, record.transport = payload.playback_url, payload.transport
        session.commit()
        return response(record)
