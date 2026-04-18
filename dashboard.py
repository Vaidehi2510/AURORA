from __future__ import annotations

import json
import sqlite3

import pandas as pd
import streamlit as st

from correlation_engine.runtime import ROOT_DIR, ensure_vendor_path

ensure_vendor_path()

import plotly.express as px

from correlation_engine import CorrelationConfig, CorrelationEngine

DB_PATH = ROOT_DIR / "db" / "aurora.db"


st.set_page_config(
    page_title="AURORA Correlation Engine",
    page_icon="A",
    layout="wide",
    initial_sidebar_state="expanded",
)


def inject_styles() -> None:
    st.markdown(
        """
        <style>
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

        :root {
            --aurora-bg: #f4efe7;
            --aurora-panel: rgba(255,255,255,0.72);
            --aurora-ink: #13241f;
            --aurora-accent: #b45309;
            --aurora-accent-2: #0f766e;
            --aurora-warn: #b91c1c;
            --aurora-border: rgba(19,36,31,0.12);
        }

        .stApp {
            background:
                radial-gradient(circle at top left, rgba(15,118,110,0.16), transparent 32%),
                radial-gradient(circle at top right, rgba(180,83,9,0.16), transparent 28%),
                linear-gradient(180deg, #f8f4ec 0%, #efe7db 100%);
            color: var(--aurora-ink);
            font-family: "Space Grotesk", sans-serif;
        }

        .block-container {
            padding-top: 2rem;
            padding-bottom: 2rem;
        }

        h1, h2, h3 {
            font-family: "Space Grotesk", sans-serif !important;
            letter-spacing: -0.02em;
        }

        .mono {
            font-family: "IBM Plex Mono", monospace;
            font-size: 0.9rem;
        }

        .hero {
            padding: 1.2rem 1.4rem;
            border: 1px solid var(--aurora-border);
            background: linear-gradient(135deg, rgba(255,255,255,0.82), rgba(255,244,230,0.8));
            border-radius: 20px;
            box-shadow: 0 16px 40px rgba(19, 36, 31, 0.08);
        }

        .metric-card, .alert-card {
            padding: 1rem 1.1rem;
            border-radius: 18px;
            border: 1px solid var(--aurora-border);
            background: var(--aurora-panel);
            box-shadow: 0 10px 30px rgba(19, 36, 31, 0.06);
            backdrop-filter: blur(12px);
        }

        .alert-card {
            border-left: 8px solid var(--aurora-accent);
            margin-bottom: 1rem;
        }

        .priority-critical { border-left-color: #7f1d1d; }
        .priority-high { border-left-color: #b45309; }
        .priority-medium { border-left-color: #0f766e; }
        .priority-low { border-left-color: #64748b; }

        .pill {
            display: inline-block;
            padding: 0.15rem 0.55rem;
            margin-right: 0.35rem;
            border-radius: 999px;
            background: rgba(15,118,110,0.12);
            color: #0f766e;
            font-size: 0.82rem;
            font-weight: 600;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def autorefresh_every(seconds: int = 45) -> None:
    st.components.v1.html(
        f"""
        <script>
        setTimeout(function() {{
            window.parent.location.reload();
        }}, {seconds * 1000});
        </script>
        """,
        height=0,
    )


@st.cache_data(ttl=30)
def load_table(name: str) -> pd.DataFrame:
    with sqlite3.connect(DB_PATH) as conn:
        return pd.read_sql_query(f"SELECT * FROM {name}", conn)


def run_engine_now() -> None:
    engine = CorrelationEngine(
        CorrelationConfig(
            enable_remote_embeddings=True,
            enable_llm_synthesis=True,
            writeback=True,
        )
    )
    engine.run()
    load_table.clear()


def read_fallback_events() -> pd.DataFrame:
    with sqlite3.connect(DB_PATH) as conn:
        return pd.read_sql_query(
            """
            SELECT event_id, source, domain, event_type, title, timestamp, facility, city, country, severity
            FROM unified_events
            WHERE is_live = 'true'
            ORDER BY timestamp DESC
            """,
            conn,
        )


def parse_json_column(frame: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    frame = frame.copy()
    for column in columns:
        if column in frame.columns:
            frame[column] = frame[column].map(
                lambda value: json.loads(value) if isinstance(value, str) and value else []
            )
    return frame


inject_styles()
autorefresh_every(45)

with st.sidebar:
    st.markdown("## Engine Control")
    st.caption("The page auto-refreshes every 45 seconds.")
    if st.button("Refresh Correlation Engine", use_container_width=True):
        run_engine_now()
        st.success("Correlation outputs refreshed.")
    st.markdown("## Sources")
    st.markdown("- `db/aurora.db` master store")
    st.markdown("- OpenRouter embeddings")
    st.markdown("- OpenRouter alert synthesis")

st.markdown(
    """
    <div class="hero">
        <div class="mono">AURORA / Option A correlation engine</div>
        <h1 style="margin-bottom:0.2rem;">Live cyber-physical alert board</h1>
        <p style="margin:0;color:#334155;">
            Rules + embeddings + graph + boosted ranking over the master SQLite database.
            The dashboard tracks simulated live signals, contextual OSINT, and historical memory.
        </p>
    </div>
    """,
    unsafe_allow_html=True,
)

tables_ready = True
try:
    alerts_df = parse_json_column(
        load_table("correlation_alerts"),
        ["why_it_matters", "next_actions", "analyst_notes", "evidence", "supporting_priors"],
    )
    clusters_df = parse_json_column(load_table("correlation_clusters"), ["event_ids", "domains", "sources"])
    edges_df = parse_json_column(load_table("correlation_edges"), ["rule_triggers"])
except Exception:
    tables_ready = False
    alerts_df = pd.DataFrame()
    clusters_df = pd.DataFrame()
    edges_df = pd.DataFrame()

if not tables_ready:
    st.info("No correlation output tables yet. Use the sidebar button to run the engine.")
    st.dataframe(read_fallback_events(), use_container_width=True, hide_index=True)
    st.stop()

if alerts_df.empty:
    st.warning("The engine ran, but no alerts cleared the current threshold.")

total_alerts = len(alerts_df)
critical_alerts = int((alerts_df["priority"] == "critical").sum()) if not alerts_df.empty else 0
top_confidence = float(alerts_df["confidence"].max()) if not alerts_df.empty else 0.0
cluster_count = len(clusters_df)

metric_columns = st.columns(4)
metric_values = [
    ("Active Alerts", total_alerts),
    ("Critical Alerts", critical_alerts),
    ("Top Confidence", f"{top_confidence:.2%}"),
    ("Correlated Clusters", cluster_count),
]
for column, (label, value) in zip(metric_columns, metric_values):
    column.markdown(
        f"""
        <div class="metric-card">
            <div class="mono">{label}</div>
            <div style="font-size:2rem;font-weight:700;margin-top:0.2rem;">{value}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

left, right = st.columns([1.4, 1])

with left:
    st.subheader("Alert Queue")
    if alerts_df.empty:
        st.caption("No alert payloads available yet.")
    for row in alerts_df.itertuples(index=False):
        reasons = "".join(f"<li>{item}</li>" for item in row.why_it_matters)
        actions = "".join(f"<li>{item}</li>" for item in row.next_actions)
        priors = "".join(
            f"<li>{item['source']} / {item['event_id']} / sim {item['similarity']:.2f}</li>"
            for item in row.supporting_priors
        )
        st.markdown(
            f"""
            <div class="alert-card priority-{row.priority}">
                <div class="mono">{row.alert_id} · {row.priority.upper()} · confidence {row.confidence:.2%}</div>
                <h3 style="margin:0.35rem 0 0.2rem 0;">{row.headline}</h3>
                <div style="margin-bottom:0.6rem;color:#475569;">
                    {row.location} · {row.time_window_start} to {row.time_window_end}
                </div>
                <div style="margin-bottom:0.45rem;">
                    <span class="pill">{row.cluster_id}</span>
                </div>
                <strong>Why it matters</strong>
                <ul>{reasons}</ul>
                <strong>Next actions</strong>
                <ul>{actions}</ul>
                <strong>Supporting memory</strong>
                <ul>{priors or '<li>No prior retrieved.</li>'}</ul>
            </div>
            """,
            unsafe_allow_html=True,
        )

with right:
    st.subheader("Graph Posture")
    if not clusters_df.empty:
        chart_df = clusters_df.copy()
        chart_df["label"] = chart_df["cluster_id"] + " · " + chart_df["primary_location"]
        fig = px.bar(
            chart_df.sort_values("mean_edge_weight", ascending=False),
            x="label",
            y=["mean_edge_weight", "mean_domain_anomaly"],
            barmode="group",
            color_discrete_sequence=["#b45309", "#0f766e"],
        )
        fig.update_layout(
            height=360,
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            margin=dict(l=20, r=20, t=20, b=20),
            legend_title_text="",
            xaxis_title="Cluster",
            yaxis_title="Score",
        )
        st.plotly_chart(fig, use_container_width=True)

    if not alerts_df.empty:
        evidence_rows = []
        for alert in alerts_df.itertuples(index=False):
            for item in alert.evidence:
                evidence_rows.append(
                    {
                        "alert_id": alert.alert_id,
                        "event_id": item["event_id"],
                        "domain": item["domain"],
                        "source": item["source"],
                        "title": item["title"],
                        "timestamp": item["timestamp"],
                        "score": item["score"],
                    }
                )
        evidence_df = pd.DataFrame(evidence_rows)
        scatter = px.scatter(
            evidence_df,
            x="timestamp",
            y="score",
            color="domain",
            symbol="source",
            hover_data=["alert_id", "event_id", "title"],
            color_discrete_sequence=["#0f766e", "#b45309", "#7c3aed", "#475569"],
        )
        scatter.update_layout(
            height=360,
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            margin=dict(l=20, r=20, t=20, b=20),
            xaxis_title="Timestamp",
            yaxis_title="Event anomaly score",
        )
        st.plotly_chart(scatter, use_container_width=True)

st.subheader("Edge Feed")
if edges_df.empty:
    st.caption("No graph edges were materialized.")
else:
    edge_view = edges_df[
        [
            "source_event_id",
            "target_event_id",
            "edge_score",
            "time_score",
            "location_score",
            "semantic_score",
            "rule_triggers",
        ]
    ].copy()
    st.dataframe(edge_view.head(20), use_container_width=True, hide_index=True)

st.subheader("Live Signals")
with sqlite3.connect(DB_PATH) as conn:
    live_df = pd.read_sql_query(
        """
        SELECT event_id, source, domain, event_type, title, facility, city, country, timestamp, severity
        FROM unified_events
        WHERE is_live = 'true'
        ORDER BY timestamp DESC
        """,
        conn,
    )
st.dataframe(live_df, use_container_width=True, hide_index=True)
