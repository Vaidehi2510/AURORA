import React from 'react'
import styles from './EventTicker.module.css'

const TYPE_COLOR = { cyber: 'var(--blue)', physical: 'var(--amber)', osint: 'var(--purple)' }

export default function EventTicker({ events }) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={`${styles.dot} animate-pulse`} />
        <span className={styles.title}>LIVE FEED</span>
        <span className={styles.count}>{events.length}</span>
      </div>
      <div className={styles.list}>
        {events.length === 0 && (
          <div className={styles.empty}>Waiting for incoming signals…</div>
        )}
        {events.map(ev => (
          <div key={ev.id} className={`${styles.item} animate-slide-in`}>
            <div className={styles.itemHead}>
              <span
                className={styles.typeDot}
                style={{ background: TYPE_COLOR[ev.type] ?? 'var(--text3)' }}
              />
              <span className={styles.typeLabel}>{ev.type.toUpperCase()}</span>
              <span className={styles.evTitle}>{ev.title}</span>
              <span className={styles.evTime}>{new Date(ev.timestamp).toLocaleTimeString()}</span>
            </div>
            <div className={styles.evLoc}>
              {ev.region} · <span className={`${styles.sev} ${styles[`sev_${ev.severity}`]}`}>{ev.severity}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
