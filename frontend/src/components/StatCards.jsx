import React from 'react'
import styles from './StatCards.module.css'

const CARDS = [
  { key: 'activeIncidents', label: 'Active Incidents',  sub: 'correlated clusters', accent: 'cyan'  },
  { key: 'highConfidence',  label: 'High Confidence',   sub: '≥70% confidence',     accent: 'red'   },
  { key: 'rawEvents',       label: 'Raw Events',         sub: 'ingested signals',    accent: 'amber' },
  { key: 'affectedRegions', label: 'Affected Regions',  sub: 'distinct locations',  accent: 'blue'  },
]

export default function StatCards({ stats }) {
  return (
    <div className={styles.grid}>
      {CARDS.map(({ key, label, sub, accent }) => (
        <div key={key} className={`${styles.card} ${styles[accent]}`}>
          <div className={styles.label}>{label}</div>
          <div className={`${styles.value} ${styles[`val_${accent}`]}`}>
            {stats[key].toLocaleString()}
          </div>
          <div className={styles.sub}>{sub}</div>
        </div>
      ))}
    </div>
  )
}
