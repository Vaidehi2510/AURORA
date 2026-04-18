import React, { useState, useEffect } from 'react'
import styles from './Header.module.css'

export default function Header({ running, totalIngested }) {
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

      <div className={`${styles.statusPill} ${running ? styles.live : styles.paused}`}>
        {running ? '● LIVE' : '◼ PAUSED'}
      </div>

      <div className={styles.feedCount}>
        {totalIngested.toLocaleString()} events ingested
      </div>

      <div className={styles.right}>
        <span className={styles.clock}>{time}</span>
      </div>
    </header>
  )
}
