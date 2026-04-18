# CrossDomain Sentinel

A defense-style fusion operations dashboard that ingests simulated cyber, physical, and OSINT event streams, correlates them by time and location, and surfaces possible coordinated incidents for analyst review.

---

## Quick Start

```bash
cd crossdomain-sentinel
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

---

## Architecture

```
src/
├── data/
│   ├── constants.js         # Event catalogs, regions, severity levels
│   └── eventGenerator.js    # Simulated event factory + 3 demo scenarios
├── engine/
│   ├── correlationEngine.js # Core correlation + confidence scoring logic
│   └── llmSynthesis.js      # Claude API integration for alert generation
├── hooks/
│   └── useSentinel.js       # Central app state: feed, events, alerts, params
├── components/
│   ├── Header.jsx            # Live status + clock
│   ├── NavTabs.jsx           # Tab navigation
│   ├── DashboardView.jsx     # Main dashboard layout
│   ├── StatCards.jsx         # Summary metric cards
│   ├── AlertsList.jsx        # Correlated alert cards with LLM text
│   ├── ExplainPanel.jsx      # Factor breakdown + analyst notes
│   ├── EventTicker.jsx       # Live incoming event feed
│   ├── MapView.jsx           # Leaflet map with event markers + alert zones
│   ├── TimelineView.jsx      # Canvas-based timeline with lane view
│   └── ControlsView.jsx      # Feed control, params, scenarios
└── styles/
    ├── global.css            # Design tokens + resets
    └── App.module.css
```

---

## How Correlation Works

Events are grouped by **region name** within a sliding time window. A cluster triggers an alert when:

1. It contains **≥2 events** from **≥2 different domains** (cyber, physical, OSINT)
2. The computed **confidence score ≥ minConfidence** (default 40%)

### Confidence Scoring (0–100)

| Factor | Max pts | Description |
|--------|---------|-------------|
| Temporal proximity | 25 | How close in time (vs. window) |
| Geographic proximity | 20 | How co-located (vs. geo radius) |
| Domain diversity | 25 | 3 domains = 25, 2 = 17, 1 = 5 |
| Severity weighting | 20 | Average severity of signals |
| Pattern match | 10 | Cyber+physical bonus |

Final score is scaled by **source reliability** (cyber 0.9, physical 0.85, OSINT 0.6).

---

## LLM Alert Synthesis

Each new correlated cluster is sent to Claude (claude-sonnet-4-20250514) via the Anthropic API. Claude returns a structured JSON object:

```json
{
  "headline": "...",
  "summary": "...",
  "recommendation": "...",
  "uncertainty": "..."
}
```

If the API is unavailable, a rule-based fallback generates the same structure from event metadata.

**Note:** The app calls the API directly from the browser. In production, proxy this through a backend to protect your API key.

---

## Demo Scenarios

Load from the **Controls** tab:

| Scenario | Signals | Expected Confidence |
|----------|---------|-------------------|
| ⚡ Critical Infrastructure | SCADA anomaly + sensor alarms + social outage posts | ~75–85% |
| 🔒 Facility Intrusion | Failed logins + badge anomaly + CCTV + emergency dispatch | ~80–90% |
| ❓ False Positive | Low-severity DNS + road closure + HVAC maintenance | ~25–35% |

---

## Controls

- **Time Window**: Sliding window for correlation (5–60 min)
- **Geo Radius**: Maximum distance between correlated signals (0.5–10 mi)
- **Min Confidence**: Threshold to surface an alert (10–90%)
- **Source Toggles**: Enable/disable cyber, physical, OSINT feeds and LLM synthesis

---

## Exporting Alerts

Open the browser console and run:

```js
// The useSentinel hook exposes alerts via React state.
// For a quick export, copy from the UI or add an export button
// that calls JSON.stringify(alerts, null, 2).
```

---

## Tech Stack

- **React 18** + **Vite** — UI framework and dev server
- **Leaflet / react-leaflet** — interactive map
- **Canvas API** — timeline rendering
- **Claude API** (claude-sonnet-4-20250514) — LLM alert synthesis
- **CSS Modules** — scoped component styles
- No Redux, no external state libs — pure React hooks
