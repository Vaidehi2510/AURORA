from __future__ import annotations

import hashlib
import json
import math
import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from correlation_engine.runtime import ROOT_DIR, ensure_vendor_path
from openai_embeddings import EmbeddingService
from openai_model import AlertSynthesisClient

ensure_vendor_path()

import networkx as nx
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression

import xgboost as xgb


STOP_ENTITY_TOKENS = {
    "",
    "a",
    "an",
    "and",
    "as",
    "at",
    "by",
    "event",
    "for",
    "from",
    "gdelt",
    "ics",
    "in",
    "incident",
    "near",
    "of",
    "on",
    "reported",
    "risk",
    "scan",
    "signal",
    "states",
    "system",
    "the",
    "to",
    "united",
    "unknown",
    "us",
    "usa",
    "water",
}


@dataclass
class CorrelationConfig:
    db_path: Path = ROOT_DIR / "db" / "aurora.db"
    embeddings_cache_path: Path = ROOT_DIR / "artifacts" / "embeddings" / "cache.sqlite"
    recent_event_horizon_hours: int = 120
    live_pair_window_minutes: int = 90
    context_pair_window_hours: int = 48
    graph_edge_threshold: float = 0.68
    alert_threshold: float = 0.62
    max_memory_candidates: int = 120
    memory_top_k: int = 4
    max_alerts: int = 8
    embedding_batch_size: int = 32
    enable_remote_embeddings: bool = True
    enable_llm_synthesis: bool = True
    writeback: bool = True


def _normalize_text(value: Any) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()


def _normalize_key(value: Any) -> str:
    return _normalize_text(value).lower().replace(" ", "_")


def _normalize_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = _normalize_text(value).lower()
    return text in {"1", "true", "yes", "y", "possible"}


def _safe_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), default=str)


def _sql_safe_value(value: Any) -> Any:
    if isinstance(value, (dict, list, tuple, set)):
        return _safe_json(value)
    return value


def _severity_to_float(value: Any) -> float:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return 0.35
    if isinstance(value, (int, float)):
        numeric = float(value)
        return max(0.0, min(1.0, numeric / 5.0 if numeric > 1 else numeric))

    text = _normalize_text(value).lower()
    mapping = {
        "none": 0.15,
        "unknown": 0.35,
        "unclear": 0.4,
        "possible": 0.5,
        "low": 0.35,
        "medium": 0.55,
        "high": 0.78,
        "critical": 0.95,
    }
    if text in mapping:
        return mapping[text]
    if "critical" in text:
        return 0.95
    if "high" in text:
        return 0.78
    if "near-miss" in text:
        return 0.62
    if "harm" in text:
        return 0.72
    if "event" in text:
        return 0.6
    return 0.45


def _extract_entities(row: pd.Series) -> list[str]:
    base_fields = [
        row.get("facility", ""),
        row.get("city", ""),
        row.get("country", ""),
        row.get("tags", ""),
        row.get("vulnerability", ""),
        row.get("technique_id", ""),
        row.get("risk_domain", ""),
        row.get("risk_subdomain", ""),
        row.get("infrastructure_type", ""),
        row.get("event_type", ""),
        row.get("title", ""),
        row.get("description", ""),
    ]
    tokens: set[str] = set()
    for field in base_fields:
        text = _normalize_text(field)
        for part in (
            text.replace("/", " ")
            .replace(",", " ")
            .replace(".", " ")
            .replace(":", " ")
            .replace("(", " ")
            .replace(")", " ")
            .replace("-", " ")
            .split()
        ):
            token = part.strip().lower()
            if not token or token in STOP_ENTITY_TOKENS or len(token) < 3:
                continue
            tokens.add(token)
    return sorted(tokens)


def _build_summary_text(row: pd.Series) -> str:
    entities = ", ".join(row["entities"][:8])
    location = row["facility"] or row["city"] or row["country"] or "unknown"
    return (
        f"Domain: {row['domain']}\n"
        f"Source: {row['source']}\n"
        f"Type: {row['event_type']}\n"
        f"Location: {location}\n"
        f"Infrastructure: {row['infrastructure_type'] or row['sector'] or 'unknown'}\n"
        f"Risk: {row['risk_domain'] or 'unknown'} / {row['risk_subdomain'] or 'unknown'}\n"
        f"Entities: {entities or 'none'}\n"
        f"Summary: {row['title']} | {row['description']}"
    )


def _cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    left_norm = np.linalg.norm(left)
    right_norm = np.linalg.norm(right)
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return float(np.dot(left, right) / (left_norm * right_norm))


class CorrelationEngine:
    def __init__(self, config: CorrelationConfig | None = None) -> None:
        self.config = config or CorrelationConfig()
        self.embedding_service = EmbeddingService(
            cache_path=self.config.embeddings_cache_path,
            enabled=self.config.enable_remote_embeddings,
        )
        self.alert_client = AlertSynthesisClient(enabled=self.config.enable_llm_synthesis)

    def run(self) -> dict[str, Any]:
        events = self._load_events()
        operational_events = self._select_operational_events(events)
        memory_events = self._select_memory_events(events, operational_events)

        operational_events, vector_lookup = self._attach_embeddings(
            operational_events, namespace="operational"
        )

        edges_df = self._build_pairwise_edges(operational_events, vector_lookup)
        clusters_df, cluster_members = self._build_clusters(operational_events, edges_df)
        alerts_df = self._score_and_build_alerts(
            operational_events,
            memory_events,
            vector_lookup,
            edges_df,
            clusters_df,
            cluster_members,
        )

        results = {
            "events": operational_events,
            "memory_events": memory_events,
            "edges": edges_df,
            "clusters": clusters_df,
            "alerts": alerts_df,
            "generated_at": pd.Timestamp.utcnow().isoformat(),
        }
        if self.config.writeback:
            self._write_results_to_db(results)
        return results

    def _load_events(self) -> pd.DataFrame:
        with sqlite3.connect(self.config.db_path) as conn:
            df = pd.read_sql_query("SELECT * FROM unified_events", conn)

        df = df.fillna("")
        df["timestamp_parsed"] = pd.to_datetime(
            df["timestamp"], utc=True, errors="coerce", format="mixed"
        )
        df["timestamp_parsed"] = df["timestamp_parsed"].fillna(pd.Timestamp("1970-01-01", tz="UTC"))
        df["is_live_bool"] = df["is_live"].map(_normalize_bool)
        df["is_simulated_bool"] = df["is_simulated"].map(_normalize_bool)
        df["severity_score"] = df["severity"].map(_severity_to_float)
        df["source_reliability"] = df.apply(self._source_reliability, axis=1)
        df["facility_key"] = df["facility"].map(_normalize_key)
        df["city_key"] = df["city"].map(_normalize_key)
        df["country_key"] = df["country"].map(_normalize_key)
        df["location_key"] = df.apply(self._location_key, axis=1)
        df["entities"] = df.apply(_extract_entities, axis=1)
        df["summary_text"] = df.apply(_build_summary_text, axis=1)
        df["domain_anomaly_score"] = self._compute_domain_anomaly_scores(df)
        df["event_key"] = df.apply(
            lambda row: row["event_id"] or hashlib.md5(row["summary_text"].encode("utf-8")).hexdigest(),
            axis=1,
        )
        return df.sort_values("timestamp_parsed").reset_index(drop=True)

    def _select_operational_events(self, events: pd.DataFrame) -> pd.DataFrame:
        max_ts = events["timestamp_parsed"].max()
        cutoff = max_ts - pd.Timedelta(hours=self.config.recent_event_horizon_hours)
        mask = (
            events["is_live_bool"]
            | (
                events["timestamp_parsed"].ge(cutoff)
                & events["record_type"].isin(["live_signal", "osint_signal", "historical_incident"])
            )
        )
        selected = events.loc[mask].copy()
        return selected.reset_index(drop=True)

    def _select_memory_events(
        self, events: pd.DataFrame, operational_events: pd.DataFrame
    ) -> pd.DataFrame:
        exclude_keys = set(operational_events["event_key"])
        mask = events["record_type"].isin(["historical_incident", "threat_context"]) & ~events[
            "event_key"
        ].isin(exclude_keys)
        memory = events.loc[mask].copy()
        return memory.reset_index(drop=True)

    def _attach_embeddings(
        self, events: pd.DataFrame, namespace: str
    ) -> tuple[pd.DataFrame, dict[str, np.ndarray]]:
        vector_lookup: dict[str, np.ndarray] = {}
        if events.empty:
            events["semantic_ready"] = []
            return events, vector_lookup

        try:
            vectors = self.embedding_service.embed_texts(
                events["summary_text"].tolist(),
                namespace=namespace,
                batch_size=self.config.embedding_batch_size,
            )
            for event_key, vector in zip(events["event_key"], vectors):
                vector_lookup[event_key] = np.array(vector, dtype=float)
            events = events.copy()
            events["semantic_ready"] = True
            return events, vector_lookup
        except Exception:
            events = events.copy()
            events["semantic_ready"] = False
            return events, vector_lookup

    def _source_reliability(self, row: pd.Series) -> float:
        base = {
            "SIM": 0.96,
            "CISA_ICS": 0.9,
            "CISA_KEV": 0.88,
            "AIID": 0.78,
            "GDELT": 0.56,
        }.get(_normalize_text(row["source"]), 0.65)
        priority = row.get("source_priority", 3)
        try:
            priority_value = float(priority)
        except Exception:
            priority_value = 3.0
        priority_bonus = max(0.0, 0.08 * (4.0 - priority_value))
        return round(min(0.99, base + priority_bonus), 3)

    def _location_key(self, row: pd.Series) -> str:
        if row["facility_key"]:
            return f"facility:{row['facility_key']}"
        if row["city_key"] and row["country_key"]:
            return f"city:{row['city_key']}|{row['country_key']}"
        if row["city_key"]:
            return f"city:{row['city_key']}"
        if row["country_key"]:
            return f"country:{row['country_key']}"
        sector = _normalize_key(row["sector"] or row["infrastructure_type"])
        return f"context:{sector}" if sector else ""

    def _compute_domain_anomaly_scores(self, events: pd.DataFrame) -> pd.Series:
        event_counts = events["event_type"].value_counts().to_dict()
        rarity_scores = events["event_type"].map(lambda value: 1.0 / math.sqrt(event_counts.get(value, 1)))
        live_bonus = events["is_live_bool"].astype(float) * 0.25
        simulated_bonus = events["is_simulated_bool"].astype(float) * 0.12
        physical_bonus = events["physical_consequence"].map(_normalize_bool).astype(float) * 0.12
        critical_bonus = events["critical_service_impact"].map(_normalize_bool).astype(float) * 0.12
        malicious_bonus = (
            events["intent"].str.lower().isin(["malicious", "hostile"]).astype(float) * 0.12
        )
        reliability_bonus = events["source_reliability"] * 0.12
        score = (
            events["severity_score"] * 0.45
            + rarity_scores * 0.18
            + live_bonus
            + simulated_bonus
            + physical_bonus
            + critical_bonus
            + malicious_bonus
            + reliability_bonus
        )
        return score.clip(0.0, 1.0).round(4)

    def _pair_window_minutes(self, left: pd.Series, right: pd.Series) -> float:
        if left["is_live_bool"] and right["is_live_bool"]:
            return float(self.config.live_pair_window_minutes)
        if left["is_live_bool"] or right["is_live_bool"]:
            return float(self.config.context_pair_window_hours * 60)
        return min(12.0 * 60.0, float(self.config.context_pair_window_hours * 60))

    def _type_compatibility(self, left: pd.Series, right: pd.Series) -> float:
        domains = tuple(sorted([left["domain"], right["domain"]]))
        domain_score = {
            ("cyber", "physical"): 1.0,
            ("cyber", "osint"): 0.85,
            ("osint", "physical"): 0.82,
            ("cyber", "cyber"): 0.55,
            ("historical", "osint"): 0.45,
            ("historical", "cyber"): 0.42,
            ("historical", "physical"): 0.35,
        }.get(domains, 0.3)

        event_pair = {left["event_type"], right["event_type"]}
        if {"port_scan", "auth_failure"} <= event_pair:
            return 1.0
        if {"auth_failure", "badge_anomaly"} <= event_pair:
            return 0.96
        if {"badge_anomaly", "news_report"} <= event_pair:
            return 0.9
        if {"port_scan", "news_report"} <= event_pair:
            return 0.82
        return domain_score

    def _location_similarity(self, left: pd.Series, right: pd.Series) -> float:
        if left["facility_key"] and left["facility_key"] == right["facility_key"]:
            return 1.0
        if left["city_key"] and left["city_key"] == right["city_key"] and left["country_key"] == right["country_key"]:
            return 0.82
        if left["country_key"] and left["country_key"] == right["country_key"]:
            return 0.25
        if _normalize_key(left["sector"]) and _normalize_key(left["sector"]) == _normalize_key(right["sector"]):
            return 0.22
        if _normalize_key(left["infrastructure_type"]) and _normalize_key(left["infrastructure_type"]) == _normalize_key(
            right["infrastructure_type"]
        ):
            return 0.22
        return 0.0

    def _entity_overlap(self, left: pd.Series, right: pd.Series) -> float:
        left_entities = set(left["entities"])
        right_entities = set(right["entities"])
        if not left_entities or not right_entities:
            return 0.0
        overlap = left_entities & right_entities
        union = left_entities | right_entities
        return len(overlap) / len(union)

    def _lexical_similarity(self, left: pd.Series, right: pd.Series) -> float:
        left_tokens = set(left["entities"])
        right_tokens = set(right["entities"])
        if not left_tokens or not right_tokens:
            return 0.0
        return len(left_tokens & right_tokens) / max(len(left_tokens), len(right_tokens))

    def _semantic_similarity(
        self,
        left: pd.Series,
        right: pd.Series,
        vector_lookup: dict[str, np.ndarray],
    ) -> float:
        left_vector = vector_lookup.get(left["event_key"])
        right_vector = vector_lookup.get(right["event_key"])
        if left_vector is not None and right_vector is not None:
            cosine = _cosine_similarity(left_vector, right_vector)
            return max(0.0, min(1.0, (cosine + 1.0) / 2.0))
        return self._lexical_similarity(left, right)

    def _time_score(self, delta_minutes: float, window_minutes: float) -> float:
        if delta_minutes > window_minutes:
            return 0.0
        return math.exp(-delta_minutes / max(15.0, window_minutes / 2.5))

    def _build_pairwise_edges(
        self, events: pd.DataFrame, vector_lookup: dict[str, np.ndarray]
    ) -> pd.DataFrame:
        rows: list[dict[str, Any]] = []
        if len(events) < 2:
            return pd.DataFrame(rows)

        sorted_events = events.sort_values("timestamp_parsed").reset_index(drop=True)
        global_window_minutes = float(self.config.context_pair_window_hours * 60)

        for left_index in range(len(sorted_events) - 1):
            left = sorted_events.iloc[left_index]
            for right_index in range(left_index + 1, len(sorted_events)):
                right = sorted_events.iloc[right_index]
                delta_minutes = abs(
                    (right["timestamp_parsed"] - left["timestamp_parsed"]).total_seconds()
                ) / 60.0
                if delta_minutes > global_window_minutes:
                    break

                pair_window = self._pair_window_minutes(left, right)
                time_score = self._time_score(delta_minutes, pair_window)
                location_score = self._location_similarity(left, right)
                compatibility_score = self._type_compatibility(left, right)
                entity_score = self._entity_overlap(left, right)

                if (
                    time_score == 0.0
                    and location_score < 0.3
                    and entity_score == 0.0
                    and compatibility_score < 0.75
                ):
                    continue

                semantic_score = self._semantic_similarity(left, right, vector_lookup)
                live_anchor = bool(left["is_live_bool"] or right["is_live_bool"])
                strong_location = location_score >= 0.82
                shared_entity_anchor = entity_score >= 0.16
                semantic_anchor = semantic_score >= 0.82 and compatibility_score >= 0.9

                if live_anchor:
                    if not (
                        time_score >= 0.18
                        and (
                            strong_location
                            or entity_score > 0
                            or semantic_anchor
                            or compatibility_score >= 0.95
                        )
                    ):
                        continue
                else:
                    if not ((strong_location and time_score >= 0.3) or shared_entity_anchor):
                        continue

                anomaly_support = float(
                    np.mean([left["domain_anomaly_score"], right["domain_anomaly_score"]])
                )
                source_diversity_bonus = 0.06 if left["source"] != right["source"] else 0.0

                edge_score = (
                    0.28 * time_score
                    + 0.2 * location_score
                    + 0.2 * semantic_score
                    + 0.14 * entity_score
                    + 0.12 * anomaly_support
                    + 0.06 * compatibility_score
                    + source_diversity_bonus
                )

                if edge_score < self.config.graph_edge_threshold:
                    continue

                triggers = []
                if time_score >= 0.5:
                    triggers.append("time_window")
                if location_score >= 0.8:
                    triggers.append("shared_location")
                if entity_score > 0:
                    triggers.append("entity_overlap")
                if semantic_score >= 0.75:
                    triggers.append("semantic_alignment")
                if compatibility_score >= 0.9:
                    triggers.append("type_compatibility")

                rows.append(
                    {
                        "source_event_id": left["event_id"],
                        "target_event_id": right["event_id"],
                        "source_key": left["event_key"],
                        "target_key": right["event_key"],
                        "edge_score": round(edge_score, 4),
                        "time_score": round(time_score, 4),
                        "location_score": round(location_score, 4),
                        "semantic_score": round(semantic_score, 4),
                        "entity_score": round(entity_score, 4),
                        "anomaly_support": round(anomaly_support, 4),
                        "compatibility_score": round(compatibility_score, 4),
                        "delta_minutes": round(delta_minutes, 2),
                        "rule_triggers": triggers,
                    }
                )

        if not rows:
            return pd.DataFrame(
                columns=[
                    "source_event_id",
                    "target_event_id",
                    "source_key",
                    "target_key",
                    "edge_score",
                    "time_score",
                    "location_score",
                    "semantic_score",
                    "entity_score",
                    "anomaly_support",
                    "compatibility_score",
                    "delta_minutes",
                    "rule_triggers",
                ]
            )
        return pd.DataFrame(rows).sort_values("edge_score", ascending=False).reset_index(drop=True)

    def _build_clusters(
        self, events: pd.DataFrame, edges_df: pd.DataFrame
    ) -> tuple[pd.DataFrame, dict[str, list[str]]]:
        graph = nx.Graph()
        for row in events.itertuples(index=False):
            graph.add_node(row.event_key)

        for edge in edges_df.itertuples(index=False):
            graph.add_edge(edge.source_key, edge.target_key, weight=edge.edge_score)

        cluster_members: dict[str, list[str]] = {}
        cluster_rows: list[dict[str, Any]] = []

        for index, component in enumerate(nx.connected_components(graph), start=1):
            component_keys = sorted(component)
            cluster_id = f"CLUSTER-{index:03d}"
            cluster_members[cluster_id] = component_keys
            cluster_events = events[events["event_key"].isin(component_keys)].copy()
            cluster_edges = edges_df[
                edges_df["source_key"].isin(component_keys)
                & edges_df["target_key"].isin(component_keys)
            ].copy()

            time_start = cluster_events["timestamp_parsed"].min()
            time_end = cluster_events["timestamp_parsed"].max()
            location_focus = (
                cluster_events["location_key"]
                .replace("", pd.NA)
                .dropna()
                .value_counts(normalize=True)
                .max()
            )
            location_focus = 0.0 if pd.isna(location_focus) else float(location_focus)
            facility_share = (
                cluster_events["facility_key"]
                .replace("", pd.NA)
                .dropna()
                .value_counts(normalize=True)
                .max()
            )
            facility_share = 0.0 if pd.isna(facility_share) else float(facility_share)

            cluster_rows.append(
                {
                    "cluster_id": cluster_id,
                    "n_events": int(len(cluster_events)),
                    "n_live_events": int(cluster_events["is_live_bool"].sum()),
                    "n_unique_domains": int(cluster_events["domain"].nunique()),
                    "n_unique_sources": int(cluster_events["source"].nunique()),
                    "mean_domain_anomaly": round(float(cluster_events["domain_anomaly_score"].mean()), 4),
                    "max_domain_anomaly": round(float(cluster_events["domain_anomaly_score"].max()), 4),
                    "mean_edge_weight": round(
                        float(cluster_edges["edge_score"].mean()) if not cluster_edges.empty else 0.0,
                        4,
                    ),
                    "max_edge_weight": round(
                        float(cluster_edges["edge_score"].max()) if not cluster_edges.empty else 0.0,
                        4,
                    ),
                    "temporal_spread_minutes": round(
                        (time_end - time_start).total_seconds() / 60.0 if len(cluster_events) > 1 else 0.0,
                        2,
                    ),
                    "location_focus": round(location_focus, 4),
                    "facility_share": round(facility_share, 4),
                    "source_reliability_mean": round(float(cluster_events["source_reliability"].mean()), 4),
                    "source_reliability_min": round(float(cluster_events["source_reliability"].min()), 4),
                    "critical_asset_count": int(
                        cluster_events["facility_key"].replace("", pd.NA).dropna().nunique()
                    ),
                    "event_type_diversity": round(
                        float(cluster_events["event_type"].nunique()) / max(1, len(cluster_events)),
                        4,
                    ),
                    "osint_report_count": int((cluster_events["domain"] == "osint").sum()),
                    "contains_physical": bool((cluster_events["domain"] == "physical").any()),
                    "contains_cyber": bool((cluster_events["domain"] == "cyber").any()),
                    "contains_live": bool(cluster_events["is_live_bool"].any()),
                    "time_window_start": time_start.isoformat(),
                    "time_window_end": time_end.isoformat(),
                    "event_ids": cluster_events["event_id"].tolist(),
                    "domains": sorted(cluster_events["domain"].unique().tolist()),
                    "sources": sorted(cluster_events["source"].unique().tolist()),
                    "primary_location": self._primary_location(cluster_events),
                }
            )

        clusters_df = pd.DataFrame(cluster_rows)
        return clusters_df, cluster_members

    def _primary_location(self, cluster_events: pd.DataFrame) -> str:
        for column in ["facility", "city", "country"]:
            values = cluster_events[column].replace("", pd.NA).dropna()
            if not values.empty:
                return str(values.mode().iloc[0])
        return "Unspecified"

    def _score_and_build_alerts(
        self,
        events: pd.DataFrame,
        memory_events: pd.DataFrame,
        vector_lookup: dict[str, np.ndarray],
        edges_df: pd.DataFrame,
        clusters_df: pd.DataFrame,
        cluster_members: dict[str, list[str]],
    ) -> pd.DataFrame:
        if clusters_df.empty:
            return pd.DataFrame(
                columns=[
                    "alert_id",
                    "cluster_id",
                    "priority",
                    "confidence",
                    "headline",
                    "location",
                    "time_window_start",
                    "time_window_end",
                    "why_it_matters",
                    "next_actions",
                    "evidence",
                    "supporting_priors",
                    "raw_json",
                ]
            )

        feature_df = clusters_df[
            [
                "n_events",
                "n_live_events",
                "n_unique_domains",
                "n_unique_sources",
                "mean_domain_anomaly",
                "max_domain_anomaly",
                "mean_edge_weight",
                "max_edge_weight",
                "temporal_spread_minutes",
                "location_focus",
                "facility_share",
                "source_reliability_mean",
                "source_reliability_min",
                "critical_asset_count",
                "event_type_diversity",
                "osint_report_count",
            ]
        ].copy()
        pseudo_labels = self._weak_supervision_labels(clusters_df)
        probabilities = self._rank_clusters(feature_df, pseudo_labels)
        clusters_df = clusters_df.copy()
        clusters_df["confidence"] = probabilities
        clusters_df["rule_score"] = clusters_df.apply(self._rule_score, axis=1)
        clusters_df["final_score"] = (
            0.7 * clusters_df["confidence"] + 0.3 * clusters_df["rule_score"]
        ).clip(0.0, 1.0)
        clusters_df["priority"] = clusters_df["final_score"].map(self._priority_from_confidence)

        candidate_clusters = clusters_df.sort_values("final_score", ascending=False)
        candidate_clusters = candidate_clusters[
            (candidate_clusters["final_score"] >= self.config.alert_threshold)
            | (candidate_clusters["contains_live"])
        ].head(self.config.max_alerts)

        alert_rows: list[dict[str, Any]] = []
        for alert_index, cluster in enumerate(candidate_clusters.itertuples(index=False), start=1):
            cluster_events = events[events["event_key"].isin(cluster_members[cluster.cluster_id])].copy()
            cluster_edges = edges_df[
                edges_df["source_key"].isin(cluster_members[cluster.cluster_id])
                & edges_df["target_key"].isin(cluster_members[cluster.cluster_id])
            ].copy()
            supporting_priors = self._retrieve_supporting_priors(
                cluster_events, memory_events, vector_lookup
            )
            alert_payload = self._compose_alert_payload(
                alert_index, cluster, cluster_events, cluster_edges, supporting_priors
            )
            llm_alert = self.alert_client.synthesize_alert(alert_payload)
            alert = self._merge_alert_payload(alert_payload, llm_alert)
            alert_rows.append(alert)

        return pd.DataFrame(alert_rows).sort_values("confidence", ascending=False).reset_index(drop=True)

    def _weak_supervision_labels(self, clusters_df: pd.DataFrame) -> np.ndarray:
        positives = (
            (clusters_df["contains_live"])
            & (clusters_df["n_unique_domains"] >= 2)
            & (clusters_df["mean_edge_weight"] >= 0.65)
        )
        negatives = (
            (clusters_df["n_unique_domains"] <= 1)
            | (clusters_df["n_events"] <= 1)
            | (clusters_df["mean_edge_weight"] < 0.45)
        )
        labels = np.where(positives, 1, 0)
        labels = np.where(negatives & ~positives, 0, labels)

        if labels.sum() == 0:
            strongest = clusters_df["contains_live"].astype(int).idxmax()
            labels[strongest] = 1
        if labels.sum() == len(labels):
            weakest = clusters_df["mean_edge_weight"].idxmin()
            labels[weakest] = 0
        return labels.astype(int)

    def _rank_clusters(self, feature_df: pd.DataFrame, labels: np.ndarray) -> np.ndarray:
        if len(feature_df) == 1:
            return np.array([0.95 if labels[0] else 0.35], dtype=float)

        features = feature_df.to_numpy(dtype=float)

        if xgb is not None:
            try:
                model = xgb.XGBClassifier(
                    n_estimators=64,
                    max_depth=3,
                    learning_rate=0.1,
                    subsample=0.9,
                    colsample_bytree=0.9,
                    eval_metric="logloss",
                )
                model.fit(features, labels)
                raw_probabilities = model.predict_proba(features)[:, 1]
                return self._calibrate_probabilities(raw_probabilities, labels)
            except Exception:
                pass

        model = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.08, random_state=42)
        model.fit(features, labels)
        raw_probabilities = model.predict_proba(features)[:, 1]
        return self._calibrate_probabilities(raw_probabilities, labels)

    def _calibrate_probabilities(
        self, raw_probabilities: np.ndarray, labels: np.ndarray
    ) -> np.ndarray:
        if len(np.unique(labels)) < 2:
            return np.clip(raw_probabilities, 0.0, 1.0)
        calibrator = IsotonicRegression(out_of_bounds="clip")
        calibrated = calibrator.fit_transform(raw_probabilities, labels)
        return np.clip(calibrated, 0.0, 1.0)

    def _rule_score(self, cluster: pd.Series) -> float:
        score = (
            0.22 * min(1.0, cluster["n_events"] / 4.0)
            + 0.18 * min(1.0, cluster["n_unique_domains"] / 3.0)
            + 0.18 * cluster["mean_edge_weight"]
            + 0.12 * cluster["max_domain_anomaly"]
            + 0.12 * cluster["location_focus"]
            + 0.1 * cluster["source_reliability_mean"]
            + 0.08 * min(1.0, cluster["osint_report_count"] / 2.0)
        )
        if cluster["contains_live"]:
            score += 0.08
        return round(min(1.0, score), 4)

    def _priority_from_confidence(self, confidence: float) -> str:
        if confidence >= 0.88:
            return "critical"
        if confidence >= 0.74:
            return "high"
        if confidence >= 0.58:
            return "medium"
        return "low"

    def _retrieve_supporting_priors(
        self,
        cluster_events: pd.DataFrame,
        memory_events: pd.DataFrame,
        vector_lookup: dict[str, np.ndarray],
    ) -> list[dict[str, Any]]:
        if memory_events.empty:
            return []

        shared_terms = set()
        for row in cluster_events.itertuples(index=False):
            shared_terms.update(row.entities)
        sector_values = {
            _normalize_key(value)
            for value in cluster_events["sector"].tolist() + cluster_events["infrastructure_type"].tolist()
            if _normalize_key(value)
        }
        cluster_domains = set(cluster_events["domain"].tolist())
        focus_terms = {
            term
            for term in shared_terms | sector_values
            if term in {"ics", "scada", "substation", "power", "energy", "outage", "badge", "access", "grid"}
        }

        candidate_mask = memory_events.apply(
            lambda row: bool(shared_terms & set(row["entities"]))
            or _normalize_key(row["sector"]) in sector_values
            or _normalize_key(row["infrastructure_type"]) in sector_values,
            axis=1,
        )
        if "cyber" in cluster_domains:
            candidate_mask = candidate_mask | memory_events["source"].isin(["CISA_ICS", "CISA_KEV"])
        if "physical" in cluster_domains:
            candidate_mask = candidate_mask | memory_events["source"].eq("AIID")

        candidates = memory_events[candidate_mask].copy()
        if candidates.empty:
            candidates = memory_events.head(self.config.max_memory_candidates).copy()
        elif len(candidates) > self.config.max_memory_candidates:
            balanced_frames = []
            balanced_ids: set[str] = set()

            if "cyber" in cluster_domains:
                ics_seed = candidates[candidates["source"] == "CISA_ICS"].head(
                    self.config.max_memory_candidates // 3
                )
                if not ics_seed.empty:
                    balanced_frames.append(ics_seed)
                    balanced_ids.update(ics_seed["event_id"].tolist())

            if "physical" in cluster_domains:
                aiid_seed = candidates[
                    (candidates["source"] == "AIID") & (~candidates["event_id"].isin(balanced_ids))
                ].head(self.config.max_memory_candidates // 3)
                if not aiid_seed.empty:
                    balanced_frames.append(aiid_seed)
                    balanced_ids.update(aiid_seed["event_id"].tolist())

            remainder = candidates[~candidates["event_id"].isin(balanced_ids)].head(
                self.config.max_memory_candidates - sum(len(frame) for frame in balanced_frames)
            )
            balanced_frames.append(remainder)
            candidates = pd.concat(balanced_frames, ignore_index=True).copy()
        else:
            candidates = candidates.copy()

        cluster_text = "\n".join(cluster_events["summary_text"].tolist()[:5])
        supporting_rows: list[dict[str, Any]] = []

        try:
            cluster_vector = np.array(
                self.embedding_service.embed_text(cluster_text, namespace="cluster_memory_query"), dtype=float
            )
            candidate_vectors = self.embedding_service.embed_texts(
                candidates["summary_text"].tolist(),
                namespace="memory_events",
                batch_size=self.config.embedding_batch_size,
            )
            candidates = candidates.copy()
            candidates["memory_similarity"] = [
                max(0.0, min(1.0, (_cosine_similarity(cluster_vector, np.array(vector, dtype=float)) + 1.0) / 2.0))
                for vector in candidate_vectors
            ]
        except Exception:
            candidates = candidates.copy()
            cluster_terms = set(_extract_entities(pd.Series({"title": cluster_text, "description": cluster_text})))
            candidates["memory_similarity"] = candidates["entities"].map(
                lambda values: len(cluster_terms & set(values)) / max(1, len(cluster_terms | set(values)))
            )

        candidates = candidates.copy()
        candidates["lexical_overlap"] = candidates["entities"].map(
            lambda values: len(shared_terms & set(values)) / max(1, len(shared_terms | set(values)))
        )
        candidates["source_bonus"] = candidates.apply(
            lambda row: self._memory_source_bonus(row, cluster_domains, focus_terms), axis=1
        )
        candidates["memory_rank_score"] = (
            candidates["memory_similarity"] + 0.18 * candidates["lexical_overlap"] + candidates["source_bonus"]
        )
        ranked_candidates = candidates.sort_values("memory_rank_score", ascending=False).copy()
        selected_frames = []
        selected_ids: set[str] = set()

        if "cyber" in cluster_domains:
            ics_slice = ranked_candidates[ranked_candidates["source"] == "CISA_ICS"].head(3)
            if not ics_slice.empty:
                selected_frames.append(ics_slice)
                selected_ids.update(ics_slice["event_id"].tolist())

        if "physical" in cluster_domains:
            aiid_slice = ranked_candidates[
                (ranked_candidates["source"] == "AIID")
                & (~ranked_candidates["event_id"].isin(selected_ids))
            ].head(1)
            if not aiid_slice.empty:
                selected_frames.append(aiid_slice)
                selected_ids.update(aiid_slice["event_id"].tolist())

        remainder = ranked_candidates[~ranked_candidates["event_id"].isin(selected_ids)].head(
            max(0, self.config.memory_top_k - len(selected_ids))
        )
        if not remainder.empty:
            selected_frames.append(remainder)

        if selected_frames:
            candidates = pd.concat(selected_frames, ignore_index=True).head(self.config.memory_top_k)
        else:
            candidates = ranked_candidates.head(self.config.memory_top_k)

        for row in candidates.itertuples(index=False):
            supporting_rows.append(
                {
                    "event_id": row.event_id,
                    "source": row.source,
                    "domain": row.domain,
                    "title": row.title,
                    "similarity": round(float(row.memory_rank_score), 4),
                    "timestamp": row.timestamp,
                }
            )
        return supporting_rows

    def _memory_source_bonus(
        self, row: pd.Series, cluster_domains: set[str], focus_terms: set[str]
    ) -> float:
        summary = row["summary_text"].lower()
        source = _normalize_text(row["source"])
        bonus = 0.0

        if "cyber" in cluster_domains and source == "CISA_ICS":
            bonus += 0.08
        if "physical" in cluster_domains and source == "AIID":
            bonus += 0.05
        if source == "CISA_KEV":
            bonus -= 0.03
        if any(term in summary for term in focus_terms):
            bonus += 0.06
        return bonus

    def _compose_alert_payload(
        self,
        alert_index: int,
        cluster: Any,
        cluster_events: pd.DataFrame,
        cluster_edges: pd.DataFrame,
        supporting_priors: list[dict[str, Any]],
    ) -> dict[str, Any]:
        evidence = []
        for row in cluster_events.sort_values(
            ["is_live_bool", "domain_anomaly_score"], ascending=[False, False]
        ).itertuples(index=False):
            evidence.append(
                {
                    "event_id": row.event_id,
                    "domain": row.domain,
                    "source": row.source,
                    "event_type": row.event_type,
                    "title": row.title,
                    "score": round(float(row.domain_anomaly_score), 4),
                    "timestamp": row.timestamp_parsed.isoformat(),
                }
            )

        why_it_matters = [
            f"{cluster.n_unique_domains} domains corroborate the same activity pattern.",
            f"{cluster.n_events} events fell inside a {cluster.temporal_spread_minutes:.0f}-minute incident envelope.",
            f"Mean edge strength reached {cluster.mean_edge_weight:.2f} with location focus {cluster.location_focus:.2f}.",
        ]
        next_actions = [
            "Validate the affected facility and control-system telemetry for the same window.",
            "Check access control, camera, or maintenance records for corroborating physical activity.",
            "Review nearby OSINT or advisory context for the same infrastructure type.",
        ]

        primary_location = cluster.primary_location or "Unspecified"
        headline = (
            f"Potential coordinated cyber-physical activity around {primary_location}"
            if cluster.n_unique_domains >= 2
            else f"Elevated {','.join(cluster.domains)} activity around {primary_location}"
        )
        return {
            "alert_id": f"ALERT-{alert_index:03d}",
            "cluster_id": cluster.cluster_id,
            "priority": cluster.priority,
            "confidence": round(float(cluster.final_score), 4),
            "time_window_start": cluster.time_window_start,
            "time_window_end": cluster.time_window_end,
            "location": primary_location,
            "headline": headline,
            "why_it_matters": why_it_matters,
            "next_actions": next_actions,
            "analyst_notes": [
                f"Top edge weight: {cluster.max_edge_weight:.2f}",
                f"Sources involved: {', '.join(cluster.sources)}",
            ],
            "evidence": evidence,
            "supporting_priors": supporting_priors,
            "cluster_features": {
                key: value
                for key, value in asdict(
                    CorrelationConfig(
                        db_path=self.config.db_path,
                        embeddings_cache_path=self.config.embeddings_cache_path,
                        recent_event_horizon_hours=self.config.recent_event_horizon_hours,
                        live_pair_window_minutes=self.config.live_pair_window_minutes,
                        context_pair_window_hours=self.config.context_pair_window_hours,
                        graph_edge_threshold=self.config.graph_edge_threshold,
                        alert_threshold=self.config.alert_threshold,
                        max_memory_candidates=self.config.max_memory_candidates,
                        memory_top_k=self.config.memory_top_k,
                        max_alerts=self.config.max_alerts,
                        embedding_batch_size=self.config.embedding_batch_size,
                        enable_remote_embeddings=self.config.enable_remote_embeddings,
                        enable_llm_synthesis=self.config.enable_llm_synthesis,
                        writeback=self.config.writeback,
                    )
                ).items()
                if key not in {"db_path", "embeddings_cache_path"}
            },
            "cluster_metrics": {
                "n_events": cluster.n_events,
                "n_live_events": cluster.n_live_events,
                "n_unique_domains": cluster.n_unique_domains,
                "n_unique_sources": cluster.n_unique_sources,
                "mean_domain_anomaly": cluster.mean_domain_anomaly,
                "max_domain_anomaly": cluster.max_domain_anomaly,
                "mean_edge_weight": cluster.mean_edge_weight,
                "max_edge_weight": cluster.max_edge_weight,
                "temporal_spread_minutes": cluster.temporal_spread_minutes,
            },
            "top_edges": cluster_edges.sort_values("edge_score", ascending=False)
            .head(5)[
                [
                    "source_event_id",
                    "target_event_id",
                    "edge_score",
                    "time_score",
                    "location_score",
                    "semantic_score",
                    "rule_triggers",
                ]
            ]
            .to_dict(orient="records"),
        }

    def _merge_alert_payload(
        self, payload: dict[str, Any], llm_alert: dict[str, Any] | None
    ) -> dict[str, Any]:
        alert = dict(payload)
        if llm_alert:
            alert["headline"] = llm_alert.get("headline") or alert["headline"]
            alert["why_it_matters"] = llm_alert.get("why_it_matters") or alert["why_it_matters"]
            alert["next_actions"] = llm_alert.get("next_actions") or alert["next_actions"]
            alert["analyst_notes"] = llm_alert.get("analyst_notes") or alert["analyst_notes"]

        alert["raw_json"] = _safe_json(alert)
        return alert

    def _write_results_to_db(self, results: dict[str, Any]) -> None:
        edges_df = results["edges"].copy()
        clusters_df = results["clusters"].copy()
        alerts_df = results["alerts"].copy()

        if not edges_df.empty:
            edges_df["rule_triggers"] = edges_df["rule_triggers"].map(_safe_json)
        if not clusters_df.empty:
            for column in ["event_ids", "domains", "sources"]:
                clusters_df[column] = clusters_df[column].map(_safe_json)
        if not alerts_df.empty:
            for column in ["why_it_matters", "next_actions", "analyst_notes", "evidence", "supporting_priors"]:
                alerts_df[column] = alerts_df[column].map(_safe_json)
            for column in alerts_df.columns:
                alerts_df[column] = alerts_df[column].map(_sql_safe_value)
        if not clusters_df.empty:
            for column in clusters_df.columns:
                clusters_df[column] = clusters_df[column].map(_sql_safe_value)
        if not edges_df.empty:
            for column in edges_df.columns:
                edges_df[column] = edges_df[column].map(_sql_safe_value)

        with sqlite3.connect(self.config.db_path) as conn:
            edges_df.to_sql("correlation_edges", conn, if_exists="replace", index=False)
            clusters_df.to_sql("correlation_clusters", conn, if_exists="replace", index=False)
            alerts_df.to_sql("correlation_alerts", conn, if_exists="replace", index=False)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_alert_confidence ON correlation_alerts(confidence)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_cluster_score ON correlation_clusters(cluster_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_edge_score ON correlation_edges(edge_score)"
            )
            conn.commit()
