import React, { useState, useEffect } from 'react'
import { useSentinel } from './hooks/useSentinel.js'
import Header from './components/Header.jsx'
import NavTabs from './components/NavTabs.jsx'
import DashboardView from './components/DashboardView.jsx'
import MapView from './components/MapView.jsx'
import TimelineView from './components/TimelineView.jsx'
import ControlsView from './components/ControlsView.jsx'
import styles from './styles/App.module.css'

const TABS = ['dashboard', 'map', 'timeline', 'controls']

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const sentinel = useSentinel()

  return (
    <div className={styles.root}>
      <Header
        running={sentinel.running}
        totalIngested={sentinel.stats.rawEvents}
        liveMode={sentinel.liveMode}
        liveError={sentinel.liveError}
      />
      <NavTabs
        tabs={TABS}
        active={activeTab}
        onChange={setActiveTab}
      />
      <div className={styles.viewContainer}>
        {activeTab === 'dashboard' && <DashboardView sentinel={sentinel} />}
        {activeTab === 'map'       && <MapView       sentinel={sentinel} />}
        {activeTab === 'timeline'  && <TimelineView  sentinel={sentinel} />}
        {activeTab === 'controls'  && <ControlsView  sentinel={sentinel} />}
      </div>
    </div>
  )
}
