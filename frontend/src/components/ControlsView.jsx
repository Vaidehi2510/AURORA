import React from 'react'
import {
  scenarioInfrastructure,
  scenarioIntrusion,
  scenarioFalsePositive,
} from '../data/eventGenerator.js'
import styles from './ControlsView.module.css'

const SCENARIOS = [
  {
    id: 'infra',
    icon: '⚡',
    title: 'Critical Infrastructure',
    desc: 'Utility cyber anomaly + sensor alarms + public outage reports',
    fn: scenarioInfrastructure,
  },
  {
    id: 'intrusion',
    icon: '🔒',
    title: 'Facility Intrusion + Cyber Diversion',
    desc: 'Failed logins + badge anomaly + emergency dispatch',
    fn: scenarioIntrusion,
  },
  {
    id: 'falsep',
    icon: '❓',
    title: 'False Positive / Low Confidence',
    desc: 'Unrelated nearby events — model shows restraint',
    fn: scenarioFalsePositive,
  },
]

function Toggle({ on, onClick }) {
  return (
    <div className={`${styles.toggle} ${on ? styles.toggleOn : ''}`} onClick={onClick}>
      <div className={styles.toggleThumb} />
    </div>
  )
}

export default function ControlsView({ sentinel }) {
  const { running, params, sources, toggleFeed, loadScenario, clearAll, updateParam, toggleSource } = sentinel

  return (
    <div className={styles.view}>

      {/* Feed Control */}
      <div className={styles.panel}>
        <div className={styles.panelTitle}>FEED CONTROL</div>
        <button
          className={`${styles.bigBtn} ${running ? styles.btnPause : styles.btnStart}`}
          onClick={toggleFeed}
        >
          {running ? '⏸ PAUSE FEED' : '▶ START FEED'}
        </button>
        <div style={{ height: 8 }} />
        <button className={`${styles.bigBtn} ${styles.btnClear}`} onClick={clearAll}>
          ✕ CLEAR ALL DATA
        </button>
      </div>

      {/* Correlation Params */}
      <div className={styles.panel}>
        <div className={styles.panelTitle}>CORRELATION PARAMETERS</div>

        <div className={styles.sliderRow}>
          <div className={styles.sliderLabel}>
            Time Window
            <span className={styles.sliderVal}>{params.timeWindowMin} min</span>
          </div>
          <input
            type="range" min="5" max="60" step="5"
            value={params.timeWindowMin}
            onChange={e => updateParam('timeWindowMin', Number(e.target.value))}
          />
        </div>

        <div className={styles.sliderRow}>
          <div className={styles.sliderLabel}>
            Geo Radius
            <span className={styles.sliderVal}>{params.geoRadiusMi.toFixed(1)} mi</span>
          </div>
          <input
            type="range" min="0.5" max="10" step="0.5"
            value={params.geoRadiusMi}
            onChange={e => updateParam('geoRadiusMi', Number(e.target.value))}
          />
        </div>

        <div className={styles.sliderRow}>
          <div className={styles.sliderLabel}>
            Min Confidence
            <span className={styles.sliderVal}>{params.minConfidence}%</span>
          </div>
          <input
            type="range" min="10" max="90" step="5"
            value={params.minConfidence}
            onChange={e => updateParam('minConfidence', Number(e.target.value))}
          />
        </div>
      </div>

      {/* Source Toggles */}
      <div className={styles.panel}>
        <div className={styles.panelTitle}>SOURCE FEEDS</div>
        {[
          ['cyber',    'Cyber Telemetry'],
          ['physical', 'Physical Incidents'],
          ['osint',    'OSINT / Public'],
          ['llm',      'LLM Alert Synthesis'],
        ].map(([key, label]) => (
          <div key={key} className={styles.toggleRow}>
            <span className={styles.toggleLabel}>{label}</span>
            <Toggle on={sources[key]} onClick={() => toggleSource(key)} />
          </div>
        ))}
      </div>

      {/* Scenarios */}
      <div className={`${styles.panel} ${styles.scenariosPanel}`}>
        <div className={styles.panelTitle}>DEMO SCENARIOS</div>
        <div className={styles.scenarioGrid}>
          {SCENARIOS.map(sc => (
            <button
              key={sc.id}
              className={styles.scenarioBtn}
              onClick={() => loadScenario(sc.fn())}
            >
              <span className={styles.scenarioIcon}>{sc.icon}</span>
              <div>
                <div className={styles.scenarioTitle}>{sc.title}</div>
                <div className={styles.scenarioDesc}>{sc.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

    </div>
  )
}
