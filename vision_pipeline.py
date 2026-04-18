from __future__ import annotations
from transformers import AutoImageProcessor, AutoModel, SamModel, SamProcessor
import torch
import torch.nn.functional as F
from PIL import Image
import numpy as np
import json
import uuid
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
DB_PATH = ROOT_DIR / "db" / "aurora.db"

print("Loading DINOv2...")
_dino_processor = AutoImageProcessor.from_pretrained("facebook/dinov2-base")
_dino_model = AutoModel.from_pretrained("facebook/dinov2-base")
_dino_model.eval()
print("DINOv2 ready.")

print("Loading SAM...")
_sam_model = SamModel.from_pretrained("facebook/sam-vit-base")
_sam_processor = SamProcessor.from_pretrained("facebook/sam-vit-base")
_sam_model.eval()
print("SAM ready.")


def embed_frame(img: Image.Image):
    inputs = _dino_processor(images=img, return_tensors="pt")
    with torch.no_grad():
        outputs = _dino_model(**inputs)
    embedding = outputs.last_hidden_state.mean(dim=1)
    patch_tokens = outputs.last_hidden_state[0, 1:]
    token_norms = patch_tokens.norm(dim=-1)
    grid = int(patch_tokens.shape[0] ** 0.5)
    attn_map = token_norms.reshape(grid, grid).detach().numpy()
    return embedding, attn_map


def build_baseline(normal_frames: list):
    print("Building baseline from " + str(len(normal_frames)) + " normal frames...")
    embeddings = []
    for i, frame in enumerate(normal_frames):
        emb, _ = embed_frame(frame)
        embeddings.append(emb)
        if (i + 1) % 5 == 0:
            print("  Embedded " + str(i + 1) + "/" + str(len(normal_frames)) + " frames")
    baseline = torch.stack(embeddings).mean(0)
    print("Baseline built.")
    return baseline


def score_frame(frame: Image.Image, baseline: torch.Tensor) -> dict:
    emb, attn_map = embed_frame(frame)
    score = float(1 - F.cosine_similarity(emb, baseline))
    hot = np.unravel_index(attn_map.argmax(), attn_map.shape)
    scale_x = frame.width / attn_map.shape[1]
    scale_y = frame.height / attn_map.shape[0]
    prompt_point = [
        int(hot[1] * scale_x + scale_x / 2),
        int(hot[0] * scale_y + scale_y / 2),
    ]
    return {
        "anomaly_score": round(score, 4),
        "prompt_point": prompt_point,
        "attn_map": attn_map.tolist(),
    }


def segment_anomaly(image: Image.Image, prompt_point: list) -> dict:
    inputs = _sam_processor(
        images=image,
        input_points=[[prompt_point]],
        return_tensors="pt",
    )
    with torch.no_grad():
        outputs = _sam_model(**inputs)
    masks = _sam_processor.image_processor.post_process_masks(
        outputs.pred_masks.cpu(),
        inputs["original_sizes"].cpu(),
        inputs["reshaped_input_sizes"].cpu(),
    )
    scores = outputs.iou_scores.cpu().squeeze()
    best = int(scores.argmax())
    mask = masks[0][0][best].numpy()
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any() or not cols.any():
        return {"bbox": [0, 0, 10, 10], "sam_confidence": 0.0}
    y1 = int(np.where(rows)[0][0])
    y2 = int(np.where(rows)[0][-1])
    x1 = int(np.where(cols)[0][0])
    x2 = int(np.where(cols)[0][-1])
    return {
        "bbox": [x1, y1, x2, y2],
        "sam_confidence": round(float(scores[best]), 4),
    }


def process_frame(
    frame: Image.Image,
    baseline: torch.Tensor,
    facility: str = "Substation Alpha",
    threshold: float = 0.18,
):
    dino = score_frame(frame, baseline)
    if dino["anomaly_score"] < threshold:
        return None
    sam = segment_anomaly(frame, dino["prompt_point"])
    desc = (
        "DINOv2 anomaly score "
        + str(dino["anomaly_score"])
        + ". SAM segmentation confidence "
        + str(sam["sam_confidence"])
        + ". Object bounding box "
        + str(sam["bbox"])
        + "."
    )
    return {
        "event_id": str(uuid.uuid4()),
        "domain": "physical",
        "source": "META_VISION",
        "record_type": "live_signal",
        "event_type": "visual_anomaly",
        "is_live": True,
        "is_simulated": False,
        "title": "Visual anomaly detected at " + facility,
        "description": desc,
        "facility": facility,
        "city": "",
        "country": "USA",
        "sector": "critical_infrastructure",
        "infrastructure_type": "ICS/SCADA",
        "risk_domain": "physical_security",
        "risk_subdomain": "unauthorized_access",
        "severity": min(5, max(1, int(dino["anomaly_score"] * 6))),
        "physical_consequence": True,
        "critical_service_impact": True,
        "intent": "unknown",
        "vulnerability": "",
        "technique_id": "T0817",
        "tags": "visual_anomaly,dino,sam,meta",
        "source_priority": 1,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "bbox": json.dumps(sam["bbox"]),
        "anomaly_score": dino["anomaly_score"],
        "sam_confidence": sam["sam_confidence"],
    }


def write_event_to_db(event: dict) -> None:
    allowed = {
        "event_id", "domain", "source", "record_type", "event_type",
        "is_live", "is_simulated", "title", "description", "facility",
        "city", "country", "sector", "infrastructure_type", "risk_domain",
        "risk_subdomain", "severity", "physical_consequence",
        "critical_service_impact", "intent", "vulnerability",
        "technique_id", "tags", "source_priority", "timestamp",
    }
    row = {k: v for k, v in event.items() if k in allowed}
    cols = ", ".join(row.keys())
    placeholders = ", ".join("?" * len(row))
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO unified_events ("
            + cols + ") VALUES (" + placeholders + ")",
            list(row.values()),
        )
        conn.commit()
