import React from 'react'
import styles from './NavTabs.module.css'

export default function NavTabs({ tabs, active, onChange }) {
  return (
    <nav className={styles.nav}>
      {tabs.map(tab => (
        <button
          key={tab}
          className={`${styles.tab} ${active === tab ? styles.active : ''}`}
          onClick={() => onChange(tab)}
        >
          {tab.toUpperCase()}
        </button>
      ))}
    </nav>
  )
}
