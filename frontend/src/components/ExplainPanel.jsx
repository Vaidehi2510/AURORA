import React from 'react'
import { explainConfidence } from '../engine/correlationEngine.js'
import styles from './ExplainPanel.module.css'

const TYPE_COLOR = { cyber: 'var(--blue)', physical: 'var(--amber)', osint: 'var(--purple)' }

const FACTOR_COLORS = {
  temporal:     'var(--cyan)',
  geographic:   'var(--green)',
  diversity:    'var(--purple)',
  severity:     'var(--red)',
  patternMatch: 'var(--amber)',
}

export default function ExplainPanel({ alert, params, onNoteChange }) {
  if (!alert) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.dot} />
          <span className={styles.title}>EXPLAINABILITY</span>
        </div>
        <div className={styles.empty}>Select an alert to view correlation factors</div>
      </div>
    )
  }

  const factors = explainConfidence(alert.events, params)
  const factorRows = [
    { key: 'temporal',     label: 'Temporal proximity' },
    { key: 'geographic',   label: 'Geographic proximity' },
    { key: 'diversity',    label: 'Domain diversity' },
    { key: 'severity',     label: 'Severity weighting' },
    { key: 'patternMatch', label: 'Pattern match' },
  ]

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.dot} />
        <span className={styles.title}>EXPLAINABILITY — {alert.region}</span>
      </div>

      <div className={styles.body}>
        {/* Factor breakdown */}
        <div className={styles.factors}>
          {factorRows.map(({ key, label }) => {
            const f = factors[key]
            return (
              <div key={key} className={styles.factorRow}>
                <span className={styles.factorLabel}>{label}</span>
                <div className={styles.barWrap}>
                  <div
                    className={styles.bar}
                    style={{ width: `${f.score}%`, background: FACTOR_COLORS[key] }}
                  />
                </div>
                <span className={styles.factorScore}>{f.score}</span>
              </div>
            )
          })}
        </div>

        {/* Metadata */}
        <div className={styles.metaRow}>
          <span>Span: <b>{factors.spanMin} min</b></span>
          <span>Max dist: <b>{factors.maxDistMi} mi</b></span>
          <span>Domains: <b>{factors.types.join(', ')}</b></span>
        </div>

        {/* Uncertainty */}
        {alert.llmData?.uncertainty && (
          <div className={styles.uncertainty}>
            <span className={styles.uncertaintyLabel}>Uncertainty</span>
            {alert.llmData.uncertainty}
          </div>
        )}

        {/* Contributing signals */}
        <div className={styles.signalsTitle}>
          CONTRIBUTING SIGNALS ({alert.events.length})
        </div>
        <div className={styles.signals}>
          {alert.events.map(ev => (
            <div
              key={ev.id}
              className={styles.signal}
              style={{ borderLeftColor: TYPE_COLOR[ev.type] ?? 'var(--border3)' }}
            >
              <div className={styles.signalTitle}>{ev.title}</div>
              <div className={styles.signalDetail}>{ev.detail}</div>
            </div>
          ))}
        </div>

        {/* Analyst notes */}
        <div className={styles.notesLabel}>ANALYST NOTES</div>
        <textarea
          className={styles.notes}
          rows={2}
          placeholder="Add investigation notes…"
          value={alert.note ?? ''}
          onChange={e => onNoteChange(alert.region, e.target.value)}
        />
      </div>
    </div>
  )
}
