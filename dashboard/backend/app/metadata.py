"""Capture metadata with provenance. Upload/processing time is never capture time."""
import csv
import io
import json
import math
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from PIL import ExifTags, Image

from .schemas import Metadata


@dataclass
class CaptureMetadata:
    latitude: float | None = None
    longitude: float | None = None
    captured_at: str | None = None
    provenance: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def apply(self, other: "CaptureMetadata"):
        if other.latitude is not None and other.longitude is not None:
            self.latitude, self.longitude = other.latitude, other.longitude
            self.provenance["gps"] = other.provenance.get("gps", "supplied")
        if other.captured_at:
            self.captured_at = other.captured_at
            self.provenance["captured_at"] = other.provenance.get("captured_at", "supplied")
        self.warnings.extend(w for w in other.warnings if w not in self.warnings)
        return self

    def info(self):
        missing = []
        if self.latitude is None or self.longitude is None:
            missing.append("gps")
        if not self.captured_at:
            missing.append("captured_at")
        warnings = list(self.warnings)
        if self.captured_at and datetime.fromisoformat(self.captured_at).tzinfo is None:
            warnings.append("Capture timezone is unknown; the original local time is preserved.")
        return {"provenance": self.provenance, "missing": missing, "warnings": list(dict.fromkeys(warnings))}


def supplied(metadata: Metadata, provenance="manual"):
    return CaptureMetadata(metadata.latitude, metadata.longitude, metadata.captured_at.isoformat() if metadata.captured_at else None, {"gps": provenance, "captured_at": provenance})


def parse_capture(value: str | None):
    if not value or not value.strip():
        return None
    value = value.strip()
    if re.match(r"^\d{4}:\d{2}:\d{2} ", value):
        value = value[:10].replace(":", "-") + value[10:]
    if re.match(r"^\d{4}\.\d{2}\.\d{2} ", value):
        value = value[:10].replace(".", "-") + value[10:]
    return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()


def exif_metadata(image: Image.Image):
    result = CaptureMetadata()
    try:
        exif = image.getexif()
        if not exif:
            return result
        try:
            details = exif.get_ifd(34665)
        except (KeyError, TypeError):
            details = {}
        timestamp = details.get(36867) or exif.get(36867)
        offset = details.get(36881) or exif.get(36881) or ""
        if timestamp:
            try:
                result.captured_at = parse_capture(str(timestamp) + str(offset))
                result.provenance["captured_at"] = "EXIF DateTimeOriginal"
            except ValueError:
                result.warnings.append("EXIF capture timestamp could not be read.")
        try:
            gps = {ExifTags.GPSTAGS.get(k, k): v for k, v in exif.get_ifd(34853).items()}
            def degrees(values):
                if len(values) != 3:
                    raise ValueError("GPS coordinates require degrees, minutes and seconds.")
                d, m, s = map(float, values)
                if not all(math.isfinite(value) and value >= 0 for value in (d, m, s)) or m >= 60 or s >= 60:
                    raise ValueError("Invalid GPS degrees, minutes or seconds.")
                return d + m / 60 + s / 3600
            if "GPSLatitude" in gps and "GPSLongitude" in gps:
                lat_ref, lon_ref = gps.get("GPSLatitudeRef"), gps.get("GPSLongitudeRef")
                if lat_ref not in {"N", "S"} or lon_ref not in {"E", "W"}:
                    raise ValueError("GPS hemisphere references are missing or invalid.")
                lat = degrees(gps["GPSLatitude"]) * (-1 if lat_ref == "S" else 1)
                lon = degrees(gps["GPSLongitude"]) * (-1 if lon_ref == "W" else 1)
                valid = Metadata(latitude=lat, longitude=lon)
                result.latitude, result.longitude = valid.latitude, valid.longitude
                result.provenance["gps"] = "EXIF GPS"
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            result.warnings.append("Embedded GPS metadata is absent or unreadable.")
    except (ValueError, TypeError, OSError):
        result.warnings.append("Embedded image metadata could not be read.")
    return result


@dataclass
class TelemetryPoint:
    offset_seconds: float
    metadata: CaptureMetadata


def read_telemetry(content: bytes, filename: str) -> list[TelemetryPoint]:
    if len(content) > 10 * 1024 * 1024:
        raise ValueError("Telemetry files must be smaller than 10 MB.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Telemetry must be UTF-8 CSV or SRT.") from exc
    points = []
    if Path(filename).suffix.lower() == ".csv":
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames or "offset_seconds" not in reader.fieldnames:
            raise ValueError("CSV requires offset_seconds, with optional latitude, longitude and captured_at columns.")
        for number, row in enumerate(reader, 2):
            try:
                offset = float(row["offset_seconds"])
                if not math.isfinite(offset) or offset < 0:
                    raise ValueError("invalid offset")
                value = Metadata(latitude=float(row["latitude"]) if (row.get("latitude") or "").strip() else None,
                                 longitude=float(row["longitude"]) if (row.get("longitude") or "").strip() else None,
                                 captured_at=parse_capture(row.get("captured_at")))
                points.append(TelemetryPoint(offset, supplied(value, "external CSV")))
            except (ValueError, TypeError, KeyError) as exc:
                raise ValueError(f"Invalid telemetry CSV row {number}: {exc}") from exc
    elif Path(filename).suffix.lower() == ".srt":
        # DJI subtitle layouts vary. Only explicit recognized latitude/longitude fields are used.
        for block in re.split(r"\r?\n\s*\r?\n", text.strip()):
            time = re.search(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->", block)
            if not time:
                continue
            h, m, s, ms = map(int, time.groups())
            lat = re.search(r"\blatitude\s*[:=]\s*(-?\d+(?:\.\d+)?)", block, re.I)
            lon = re.search(r"\blong(?:itude|titude)\s*[:=]\s*(-?\d+(?:\.\d+)?)", block, re.I)
            stamp = re.search(r"\d{4}[.\-]\d{2}[.\-]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})?", block)
            if lat and lon or stamp:
                try:
                    value = Metadata(latitude=float(lat[1]) if lat and lon else None, longitude=float(lon[1]) if lat and lon else None,
                                     captured_at=parse_capture(stamp[0].replace(",", ".")) if stamp else None)
                    points.append(TelemetryPoint(h * 3600 + m * 60 + s + ms / 1000, supplied(value, "external SRT")))
                except ValueError as exc:
                    raise ValueError(f"Invalid SRT telemetry: {exc}") from exc
    else:
        raise ValueError("Telemetry files must use .csv or .srt.")
    if not points:
        raise ValueError("No recognized telemetry records. Use the supplied CSV format; DJI SRT layouts vary.")
    return sorted(points, key=lambda point: point.offset_seconds)


def match_telemetry(points, seconds, tolerance):
    if not points:
        return CaptureMetadata()
    closest = min(points, key=lambda point: abs(point.offset_seconds - seconds))
    if abs(closest.offset_seconds - seconds) > tolerance:
        return CaptureMetadata(warnings=["No telemetry sample within the synchronization tolerance."])
    # GPS uses nearest sample; absolute time follows the frame's actual offset.
    result = CaptureMetadata(closest.metadata.latitude, closest.metadata.longitude, closest.metadata.captured_at,
                             dict(closest.metadata.provenance), list(closest.metadata.warnings))
    if result.captured_at:
        result.captured_at = (datetime.fromisoformat(result.captured_at) + timedelta(seconds=seconds - closest.offset_seconds)).isoformat()
    return result


def video_metadata(path):
    result = CaptureMetadata()
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        result.warnings.append("ffprobe is unavailable; embedded video tags were not inspected.")
        return result
    try:
        process = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format_tags:stream_tags", "-of", "json", str(path)],
                                 capture_output=True, text=True, timeout=30, check=True)
        data = json.loads(process.stdout)
        tags = dict(data.get("format", {}).get("tags", {}))
        for stream in data.get("streams", []):
            tags.update(stream.get("tags", {}))
        stamp = tags.get("creation_time") or tags.get("com.apple.quicktime.creationdate")
        if stamp:
            result.captured_at = parse_capture(stamp)
            result.provenance["captured_at"] = "video creation_time tag (verify camera clock)"
        location = tags.get("location") or tags.get("com.apple.quicktime.location.ISO6709")
        if location:
            match = re.match(r"([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)", location)
            if match:
                coords = Metadata(latitude=float(match[1]), longitude=float(match[2]))
                result.latitude, result.longitude = coords.latitude, coords.longitude
                result.provenance["gps"] = "embedded video location"
    except (subprocess.SubprocessError, OSError, ValueError, KeyError):
        result.warnings.append("Video metadata could not be read; supply metadata or telemetry if available.")
    return result
