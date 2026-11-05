# BoxTurtles

## AI-Powered Eastern Box Turtle Detection

BoxTurtles is a computer vision project focused on identifying Eastern Box Turtles (*Terrapene carolina*) using AI-powered object detection.

Our goal is to help protect turtles on construction sites by eventually using drone imagery to locate turtles before land clearing begins, allowing people to safely relocate them.

## How It Works

We developed an object detection model using YOLO26s.

Our training process included:

1. Collecting 500 research-grade box turtle images from iNaturalist.
2. Annotating images using Roboflow.
3. Converting polygon annotations into bounding boxes.
4. Training an initial model (turtle1).
5. Adding approximately 200 turtle-free images as negative examples to reduce false positives.
6. Training an improved model (turtle2).

## Model Results

Our current model, turtle2, produced the following results:

| Evaluation | Result |
|---|---|
| Test turtles detected | 48 / 50 |
| Held-out negative images incorrectly flagged | 1 / 72 |
| Working confidence threshold | 0.5 |
| Model | YOLO26s |
| Image size | 640 |

These results are from ground-level photographs, not aerial imagery.

## Technologies Used

- Python
- YOLO26s
- Ultralytics
- Kaggle Notebooks
- Roboflow
- iNaturalist

## Repository Contents

- `challenge-x.ipynb` – Kaggle notebook containing the model training and evaluation workflow.

## Current Limitations

The model has not yet been evaluated on aerial or drone imagery. Its performance at different flight heights remains unknown.

## Future Work

- Collect aerial photographs at different heights.
- Evaluate detection accuracy from above.
- Retrain the model using aerial imagery.
- Test with actual drone footage.
- Evaluate coverage and detection performance for wildlife monitoring.

## Dataset

The annotated dataset is privately hosted on Kaggle and is not included in this repository.

## Project Status

<em>Active development – currently transitioning from ground-level detection to aerial detection.</em>

## Turtle Survey Dashboard

The [dashboard](dashboard/README.md) adds a local website for reviewing turtle detections from uploaded photographs and recorded DJI Avata 2 footage. Its **Asian Baddies** interface includes light/dark themes, a review queue, verified sightings, maps, video frame sampling, replaceable YOLO adapters and a MediaMTX preview setup page.

Demo mode works without a model file, drone or paid API. The live page is a browser preview; the Goggles N3/Android bridge and live inference still need hardware integration. The model's aerial accuracy remains unverified.

After cloning this repository, open `dashboard/` and follow its [Windows/Linux installation instructions](dashboard/README.md#fresh-installation-windows). Use Python 3.11/3.12 and Node.js 22.12 or newer; dependencies and runtime data are not committed. The original training notebook remains at the repository root.
