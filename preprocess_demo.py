"""
Run DINOv2 + SAM on all demo frames offline.
Saves results to artifacts/demo_events.json
Load this at demo time — no inference latency.
"""

from vision_pipeline import build_baseline, process_frame
from PIL import Image
import torch, json, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NORMAL_DIR = ROOT / "demo_frames" / "normal"
ANOMALY_DIR = ROOT / "demo_frames" / "anomaly"
ARTIFACTS_DIR = ROOT / "artifacts"
ARTIFACTS_DIR.mkdir(exist_ok=True)

# ── STEP 1: Build baseline from normal frames ────────────────
print("Loading normal frames...")
normal_frames = sorted(NORMAL_DIR.glob("*.jpg"))[:20]  # use first 20
frames = [Image.open(f).resize((224, 224)) for f in normal_frames]
baseline = build_baseline(frames)
torch.save(baseline, ARTIFACTS_DIR / "dino_baseline.pt")
print(f"Baseline saved to artifacts/dino_baseline.pt")

# ── STEP 2: Score all frames (normal + anomaly) ──────────────
results = []
all_frames = (
    [(p, "normal") for p in sorted(NORMAL_DIR.glob("*.jpg"))] +
    [(p, "anomaly") for p in sorted(ANOMALY_DIR.glob("*.jpg"))]
)

print(f"Processing {len(all_frames)} frames...")
for i, (frame_path, frame_type) in enumerate(all_frames):
    img = Image.open(frame_path).resize((224, 224))
    event = process_frame(img, baseline, facility="Substation Alpha", threshold=0.18)
    results.append({
        "frame_index": i,
        "frame_path": str(frame_path),
        "frame_type": frame_type,
        "event": event,
    })
    if (i + 1) % 10 == 0:
        fired = sum(1 for r in results if r["event"] is not None)
        print(f"  Processed {i+1}/{len(all_frames)} | Events fired: {fired}")

# ── STEP 3: Save results ─────────────────────────────────────
out_path = ARTIFACTS_DIR / "demo_events.json"
with open(out_path, "w") as f:
    json.dump(results, f, indent=2)

fired = sum(1 for r in results if r["event"] is not None)
print(f"\nDone.")
print(f"Total frames processed: {len(results)}")
print(f"Events fired: {fired}")
print(f"Saved to: {out_path}")
