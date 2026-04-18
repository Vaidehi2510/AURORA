from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Iterable, Sequence

from correlation_engine.runtime import ROOT_DIR, env, ensure_vendor_path

ensure_vendor_path()

from openai import OpenAI


def _json_dumps(values: Sequence[float]) -> str:
    return json.dumps(list(values), separators=(",", ":"))


class EmbeddingService:
    """OpenRouter-backed embedding client with a SQLite cache."""

    def __init__(
        self,
        cache_path: Path | None = None,
        model: str | None = None,
        enabled: bool = True,
    ) -> None:
        self.enabled = enabled
        self.cache_path = cache_path or (ROOT_DIR / "artifacts" / "embeddings" / "cache.sqlite")
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.model = model or env("AURORA_EMBEDDING_MODEL", "openai/text-embedding-3-small")
        self.client = None
        api_key = env("OPENROUTER_API_KEY")
        if self.enabled and api_key:
            self.client = OpenAI(
                base_url=env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
                api_key=api_key,
            )
        self._ensure_cache()

    def _ensure_cache(self) -> None:
        with sqlite3.connect(self.cache_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS embeddings_cache (
                    namespace TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    text TEXT NOT NULL,
                    model TEXT NOT NULL,
                    embedding_json TEXT NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(namespace, content_hash)
                )
                """
            )
            conn.commit()

    @staticmethod
    def _hash_text(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def _fetch_cached(self, namespace: str, text: str) -> list[float] | None:
        content_hash = self._hash_text(text)
        with sqlite3.connect(self.cache_path) as conn:
            row = conn.execute(
                """
                SELECT embedding_json
                FROM embeddings_cache
                WHERE namespace = ? AND content_hash = ?
                """,
                (namespace, content_hash),
            ).fetchone()
        if row is None:
            return None
        return json.loads(row[0])

    def _store_cached(self, namespace: str, text: str, embedding: Sequence[float]) -> None:
        content_hash = self._hash_text(text)
        with sqlite3.connect(self.cache_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO embeddings_cache
                (namespace, content_hash, text, model, embedding_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (namespace, content_hash, text, self.model, _json_dumps(embedding)),
            )
            conn.commit()

    def embed_texts(
        self,
        texts: Iterable[str],
        namespace: str = "default",
        batch_size: int = 32,
    ) -> list[list[float]]:
        text_list = [str(text).strip() for text in texts]
        if not text_list:
            return []

        cached: dict[int, list[float]] = {}
        missing_indices: list[int] = []
        missing_texts: list[str] = []

        for idx, text in enumerate(text_list):
            embedding = self._fetch_cached(namespace, text)
            if embedding is None:
                missing_indices.append(idx)
                missing_texts.append(text)
            else:
                cached[idx] = embedding

        if missing_texts:
            if self.client is None:
                raise RuntimeError(
                    "OpenRouter embeddings are not configured. Set OPENROUTER_API_KEY in .env "
                    "or disable remote embeddings in the engine config."
                )
            for start in range(0, len(missing_texts), batch_size):
                batch = missing_texts[start : start + batch_size]
                response = self.client.embeddings.create(
                    extra_headers={
                        "HTTP-Referer": env("OPENROUTER_SITE_URL", "https://aurora.local"),
                        "X-OpenRouter-Title": env("OPENROUTER_SITE_NAME", "AURORA"),
                    },
                    model=self.model,
                    input=batch,
                    encoding_format="float",
                )
                for offset, item in enumerate(response.data):
                    text = batch[offset]
                    original_idx = missing_indices[start + offset]
                    vector = list(item.embedding)
                    cached[original_idx] = vector
                    self._store_cached(namespace, text, vector)

        return [cached[idx] for idx in range(len(text_list))]

    def embed_text(self, text: str, namespace: str = "default") -> list[float]:
        return self.embed_texts([text], namespace=namespace)[0]
