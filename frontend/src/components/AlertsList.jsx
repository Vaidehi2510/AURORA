import React from 'react'
import styles from './AlertsList.module.css'

function confidenceClass(score) {
  if (score >= 70) return styles.confHigh
  if (score >= 50) return styles.confMed
  return styles.confLow
}

function AlertCard({ alert, selected, onSelect }) {
  const types = [...new Set(alert.events.map(e => e.type))]

  return (
    <div
      className={`${styles.card} ${selected ? styles.selected : ''} animate-slide-in`}
      onClick={() => onSelect(alert.id)}
    >
      <div className={styles.cardHeader}>
        <span className={`${styles.confBadge} ${confidenceClass(alert.score)}`}>
          {alert.score}%
        </span>
        <span className={styles.headline}>
          {alert.llmData?.headline ?? `Possible coordinated activity — ${alert.region}`}
        </span>
      </div>

      <div className={styles.meta}>
        <span>📍 {alert.region}</span>
        <span>⏱ {alert.events.length} signals</span>
        <span>{new Date(alert.updatedAt).toLocaleTimeString()}</span>
      </div>

      <div className={styles.tags}>
        {types.map(t => (
          <span key={t} className={`${styles.tag} ${styles[`tag_${t}`]}`}>
            {t.toUpperCase()}
          </span>
        ))}
        {alert.score >= 70 && (
          <span className={`${styles.tag} ${styles.tag_crit}`}>HIGH CONF</span>
        )}
      </div>

      {alert.llmLoading ? (
        <div className={styles.llmLoading}>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
          Synthesizing analysis…
        </div>
      ) : (
        <>
          <div className={styles.summary}>{alert.llmData?.summary}</div>
          {alert.llmData?.recommendation && (
            <div className={styles.action}>→ {alert.llmData.recommendation}</div>
          )}
        </>
      )}
    </div>
  )
}

export default function AlertsList({ alerts, selectedId, onSelect }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.dot} />
        <span className={styles.title}>CORRELATED ALERTS</span>
        <span className={styles.count}>{alerts.length}</span>
        <span className={styles.hint}>click to expand</span>
      </div>
      <div className={styles.list}>
        {alerts.length === 0 ? (
          <div className={styles.empty}>No correlated alerts yet. Start the feed or load a scenario.</div>
        ) : (
          alerts.map(a => (
            <AlertCard
              key={a.id}
              alert={a}
              selected={selectedId === a.id}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  )
}
