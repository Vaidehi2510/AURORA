import React, { useState, useEffect } from 'react'
import styles from './Header.module.css'

export default function Header({
  running,
  totalIngested,
  liveMode,
  liveFeedPaused = false,
  liveError,
}) {
  const [time, setTime] = useState('')

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-US', { hour12: false }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <div className={styles.logoIcon} />
        <span>CROSSDOMAIN SENTINEL</span>
      </div>

      <div
        className={`${styles.statusPill} ${
          liveMode && !liveFeedPaused
            ? styles.liveDb
            : liveMode && liveFeedPaused
              ? styles.paused
              : running
                ? styles.live
                : styles.paused
        }`}
        title={liveError || ''}
      >
        {liveMode
          ? liveFeedPaused
            ? '◼ DB PAUSED'
            : '◉ AURORA DB'
          : running
            ? '● LIVE'
            : '◼ PAUSED'}
      </div>

      <div className={styles.feedCount}>
        {liveMode
          ? liveError ?? 'Synced from SQLite API'
          : `${totalIngested.toLocaleString()} events ingested`}
      </div>

      <div className={styles.right}>
        <span className={styles.clock}>{time}</span>
      </div>
    </header>
  )
}
