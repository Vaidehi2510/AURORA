import React, { useEffect, useState } from 'react'
import styles from './Header.module.css'
import auroraLogo from '../../../aurora_logo_v3.svg'
import NavTabs from './NavTabs.jsx'

export default function Header({ tabs, activeTab, onTabChange }) {
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
        <img
          className={styles.logoImage}
          src={auroraLogo}
          alt="AURORA"
          loading="eager"
          draggable="false"
        />
      </div>

      <div className={styles.navSlot}>
        <NavTabs tabs={tabs} active={activeTab} onChange={onTabChange} />
      </div>

      <div className={styles.right}>
        <span className={styles.clock}>{time}</span>
      </div>
    </header>
  )
}
