import React, { useCallback } from 'react'
import StatCards from './StatCards.jsx'
import AlertsList from './AlertsList.jsx'
import ExplainPanel from './ExplainPanel.jsx'
import EventTicker from './EventTicker.jsx'
import DashboardChatPanel from './DashboardChatPanel.jsx'
import styles from './DashboardView.module.css'

export default function DashboardView({ sentinel }) {
  const {
    alerts, ticker, stats,
    selectedAlertId, setSelectedAlertId,
    params, updateNote,
    running, toggleFeed,
    liveMode, liveFeedPaused, toggleLiveFeedPause,
    liveApiAvailable,
  } = sentinel

  const selectedAlert = alerts.find(a => a.id === selectedAlertId) ?? null

  const handleFeedToggle = useCallback(() => {
    if (liveMode && liveApiAvailable) toggleLiveFeedPause()
    else if (!liveMode) toggleFeed()
  }, [liveMode, liveApiAvailable, toggleLiveFeedPause, toggleFeed])

  return (
    <div className={styles.view}>
      <StatCards stats={stats} />
      <div className={styles.body}>
        <div className={styles.leftCol}>
          <AlertsList
            alerts={alerts}
            selectedId={selectedAlertId}
            onSelect={setSelectedAlertId}
          />
          <ExplainPanel
            alert={selectedAlert}
            params={params}
            onNoteChange={updateNote}
          />
        </div>
        <div className={styles.mainCol}>
          <DashboardChatPanel
            variant="main"
            selectedAlert={selectedAlert}
            alerts={alerts}
            ticker={ticker}
            stats={stats}
          />
        </div>
        <div className={styles.sideFeed}>
          <EventTicker
            events={ticker}
            feedActive={liveMode ? !liveFeedPaused : running}
            onToggleFeed={handleFeedToggle}
            feedToggleDisabled={liveMode && !liveApiAvailable}
            liveMode={liveMode}
          />
        </div>
      </div>
    </div>
  )
}
