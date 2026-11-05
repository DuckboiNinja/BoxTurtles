"""Offline synthetic fixtures: illustrations and locations are explicitly demo data."""
import math
import random
from datetime import datetime, timedelta, timezone

from PIL import Image, ImageDraw, ImageFilter
from sqlalchemy import select

from .db import Detection, now
from .ingestion import save_frame
from .metadata import CaptureMetadata
from .schemas import Candidate


def scene(seed):
    rng = random.Random(seed)
    image = Image.new("RGB", (960, 640), "#404d31")
    draw = ImageDraw.Draw(image)
    palette = ["#4f613d", "#637046", "#6c6947", "#374c36", "#293e30", "#7d7850", "#8b8058"]
    for _ in range(800):
        x, y, r = rng.randrange(960), rng.randrange(640), rng.randrange(2, 36)
        draw.ellipse((x-r, y-r, x+r, y+r), fill=rng.choice(palette))
    image = image.filter(ImageFilter.GaussianBlur(2.2))
    draw = ImageDraw.Draw(image)
    for _ in range(90):
        x, y = rng.randrange(960), rng.randrange(640)
        draw.line((x, y, x + rng.randrange(-60, 60), y + rng.randrange(30, 120)), fill="#80905c", width=2)
    # Stylized eastern box turtle, not a real wildlife photograph.
    cx, cy = 480 + rng.randrange(-70, 70), 320 + rng.randrange(-35, 35)
    draw.ellipse((cx-104, cy-57, cx+112, cy+75), fill="#29301e")
    for dx, dy in [(-55, -66), (55, -66), (-60, 66), (60, 66)]:
        draw.ellipse((cx+dx-17, cy+dy-19, cx+dx+17, cy+dy+19), fill="#a38f55")
    draw.ellipse((cx-23, cy-110, cx+23, cy-63), fill="#ba9c53")
    draw.ellipse((cx-83, cy-81, cx+83, cy+88), fill="#a8873a", outline="#d3b46b", width=4)
    for row in range(-2, 3):
        for col in range(-1, 2):
            x, y = cx + col * 45, cy + row * 29
            if ((x-cx)/78)**2 + ((y-cy)/85)**2 < 0.75:
                polygon = [(x+23*math.cos(a*math.pi/3), y+23*math.sin(a*math.pi/3)) for a in range(6)]
                draw.polygon(polygon, fill="#544526", outline="#d3a44a", width=3)
                draw.line((x-10, y+8, x+9, y-8), fill="#b99646", width=4)
    draw.text((22, 610), "SYNTHETIC DEMO / NOT A FIELD OBSERVATION", fill="#e0ddbc")
    return image, (cx-115, cy-120, cx+120, cy+105)


def seed_demo(session, storage):
    if session.scalar(select(Detection.id).limit(1)):
        return
    anchor = datetime(2026, 10, 18, 14, 32, tzinfo=timezone.utc)
    for index in range(12):
        image, bbox = scene(80 + index)
        metadata = CaptureMetadata(latitude=35.91 + index * 0.0023 if index != 5 else None,
                                   longitude=-78.97 + index * 0.0018 if index != 5 else None,
                                   captured_at=(anchor - timedelta(minutes=17 * index)).isoformat() if index != 7 else None,
                                   provenance={"gps": "synthetic demo", "captured_at": "synthetic demo"},
                                   warnings=["Synthetic fixture. Image, location and timestamps are demonstration data."])
        _, detections = save_frame(session, storage, image, f"woodland_survey_{index+1:03}.jpg", "demo-survey", metadata,
                                   candidates=[Candidate(confidence=round(0.96-index*0.027, 3), bounding_box=bbox)],
                                   model_id="demo", model_name="Demo simulator", is_mock=True, is_demo=True)
        if index >= 7:
            detections[0].status = "verified" if index < 11 else "rejected"
            detections[0].reviewed_at = now()
            session.commit()
