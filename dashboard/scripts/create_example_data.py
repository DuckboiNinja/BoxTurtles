"""Generate offline image/video fixtures for exercising uploads; no AI services."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import cv2
import numpy as np

from backend.app.demo import scene


def main():
    folder = ROOT / "examples" / "generated"
    folder.mkdir(exist_ok=True)
    image, _ = scene(90)
    image.save(folder / "synthetic-turtle.jpg", quality=94)
    video_path = folder / "synthetic-flight.avi"
    writer = cv2.VideoWriter(str(video_path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (960, 640))
    if not writer.isOpened():
        raise RuntimeError("OpenCV cannot create the example video on this computer.")
    frame = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    for index in range(60):
        writer.write(np.roll(frame, index, axis=1))
    writer.release()
    print(f"Created synthetic-turtle.jpg and synthetic-flight.avi in {folder}")
    print("These are synthetic fixtures. examples/telemetry.csv contains demonstration coordinates.")


if __name__ == "__main__":
    main()
