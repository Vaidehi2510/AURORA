import React, { useEffect, useState } from 'react'
import {
  scenarioInfrastructure,
  scenarioIntrusion,
  scenarioFalsePositive,
} from '../data/eventGenerator.js'
import {
  auroraApiConfigured,
  fetchAnalystChatStatus,
  fetchVoiceStatus,
} from '../api/auroraClient.js'
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
  const {
    running, params, sources, toggleFeed, loadScenario, clearAll, updateParam, toggleSource,
    liveMode, liveApiAvailable, toggleLiveMode, refreshLive, runBackendEngine, engineRunning,
  } = sentinel
  const [voiceInfo, setVoiceInfo] = useState(null)
  const [chatInfo, setChatInfo] = useState(null)

  useEffect(() => {
    if (!auroraApiConfigured()) return undefined
    let cancelled = false
    ;(async () => {
      const [chatResult, voiceResult] = await Promise.allSettled([
        fetchAnalystChatStatus(),
        fetchVoiceStatus(),
      ])
      if (cancelled) return
      setChatInfo(chatResult.status === 'fulfilled' ? chatResult.value : { configured: false })
      setVoiceInfo(voiceResult.status === 'fulfilled' ? voiceResult.value : { configured: false })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className={styles.view}>

      {liveApiAvailable && (
        <div className={styles.panel}>
          <div className={styles.panelTitle}>BACKEND (SQLITE + ENGINE)</div>
          <button
            type="button"
            className={`${styles.bigBtn} ${liveMode ? styles.btnPause : styles.btnStart}`}
            onClick={toggleLiveMode}
          >
            {liveMode ? '⏸ LEAVE LIVE DB MODE' : '▶ USE LIVE AURORA DATA'}
          </button>
          <div style={{ height: 8 }} />
          <button
            type="button"
            className={`${styles.bigBtn} ${styles.btnStart}`}
            disabled={!liveMode || engineRunning}
            onClick={refreshLive}
          >
            {engineRunning ? '…' : '↻ REFRESH FROM API'}
          </button>
          <div style={{ height: 8 }} />
          <button
            type="button"
            className={`${styles.bigBtn} ${styles.btnClear}`}
            disabled={engineRunning}
            onClick={runBackendEngine}
          >
            {engineRunning ? 'RUNNING ENGINE…' : '⚙ RUN CORRELATION ENGINE (SERVER)'}
          </button>
          <p className={styles.hint}>
            Live mode polls the FastAPI service (same DB as the Streamlit dashboard). Start it with{' '}
            <code className={styles.code}>uvicorn api:app --port 8000</code> or Docker service{' '}
            <code className={styles.code}>aurora-api</code>.
          </p>
        </div>
      )}

      {liveApiAvailable && (
        <div className={styles.panel}>
          <div className={styles.panelTitle}>VOICE + AI STATUS</div>
          <div className={styles.statusGrid}>
            <div className={styles.statusRow}>
              <span className={styles.toggleLabel}>Analyst chat</span>
              <span className={chatInfo?.configured ? styles.statusGood : styles.statusBad}>
                {chatInfo?.configured ? 'READY' : 'OFFLINE'}
              </span>
            </div>
            <div className={styles.statusRow}>
              <span className={styles.toggleLabel}>ElevenLabs STT</span>
              <span className={voiceInfo?.stt ? styles.statusGood : styles.statusBad}>
                {voiceInfo?.stt ? 'READY' : 'OFFLINE'}
              </span>
            </div>
            <div className={styles.statusRow}>
              <span className={styles.toggleLabel}>ElevenLabs TTS</span>
              <span className={voiceInfo?.tts ? styles.statusGood : styles.statusBad}>
                {voiceInfo?.tts ? 'READY' : 'OFFLINE'}
              </span>
            </div>
          </div>
          <div className={styles.metaStack}>
            {chatInfo?.model && (
              <div className={styles.metaLine}>
                Chat model: <code className={styles.code}>{chatInfo.model}</code>
              </div>
            )}
            {voiceInfo?.sttModel && (
              <div className={styles.metaLine}>
                STT model: <code className={styles.code}>{voiceInfo.sttModel}</code>
              </div>
            )}
            {voiceInfo?.ttsModel && (
              <div className={styles.metaLine}>
                TTS model: <code className={styles.code}>{voiceInfo.ttsModel}</code>
              </div>
            )}
            {voiceInfo?.voiceId && (
              <div className={styles.metaLine}>
                Voice ID: <code className={styles.code}>{voiceInfo.voiceId}</code>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Feed Control */}
      <div className={styles.panel}>
        <div className={styles.panelTitle}>FEED CONTROL</div>
        <button
          className={`${styles.bigBtn} ${running ? styles.btnPause : styles.btnStart}`}
          onClick={toggleFeed}
          disabled={liveMode}
        >
          {liveMode ? 'DEMO FEED (OFF IN LIVE MODE)' : running ? '⏸ PAUSE FEED' : '▶ START FEED'}
        </button>
        <div style={{ height: 8 }} />
        <button
          className={`${styles.bigBtn} ${styles.btnClear}`}
          onClick={clearAll}
          disabled={liveMode}
        >
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
            disabled={liveMode}
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
            disabled={liveMode}
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
            disabled={liveMode}
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
            <Toggle on={sources[key]} onClick={() => !liveMode && toggleSource(key)} />
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
              disabled={liveMode}
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
