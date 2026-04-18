import React from 'react'
import styles from './DashboardChatPanel.module.css'

const PLACEHOLDER_MESSAGES = [
  {
    id: 'p1',
    role: 'system',
    time: '—',
    body: 'Secure channel not configured. UI preview only.',
  },
  {
    id: 'p2',
    role: 'you',
    time: '—',
    body: 'Analyst note: hold correlation review until comms go live.',
  },
  {
    id: 'p3',
    role: 'peer',
    time: '—',
    body: 'Copy. Standing by on fusion desk.',
  },
]

export default function DashboardChatPanel({ variant = 'compact' }) {
  const panelClass =
    variant === 'main' ? `${styles.panel} ${styles.panelMain}` : styles.panel

  return (
    <div className={panelClass}>
      <div className={styles.header}>
        <span className={styles.dot} />
        <span className={styles.title}>ANALYST CHAT</span>
        <span className={styles.badge}>Offline</span>
      </div>

      <div className={styles.thread} aria-label="Chat preview (not connected)">
        {PLACEHOLDER_MESSAGES.map(msg => (
          <div key={msg.id} className={styles.msg}>
            <div className={styles.msgMeta}>
              <span className={styles[`role_${msg.role}`]}>{msg.role}</span>
              <span className={styles.msgTime}>{msg.time}</span>
            </div>
            <div className={styles.msgBody}>{msg.body}</div>
          </div>
        ))}
      </div>

      <div className={styles.composer}>
        <textarea
          className={styles.input}
          rows={2}
          placeholder="Messaging disabled — wire backend to enable send/receive."
          disabled
        />
        <button type="button" className={styles.send} disabled>
          Send
        </button>
      </div>
    </div>
  )
}
