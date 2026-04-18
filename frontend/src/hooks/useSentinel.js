import { useState, useEffect, useRef, useCallback } from 'react'
import { makeEvent } from '../data/eventGenerator.js'
import { correlateEvents } from '../engine/correlationEngine.js'
import { synthesizeAlert } from '../engine/llmSynthesis.js'
import { DEFAULT_PARAMS, EVENT_TYPES } from '../data/constants.js'
import {
  auroraApiConfigured,
  fetchRawData,
  fetchSnapshot,
  runEngineOnServer,
} from '../api/auroraClient.js'

const pick = arr => arr[Math.floor(Math.random() * arr.length)]
const TYPES = Object.values(EVENT_TYPES)

const POLL_MS = 5000

export function useSentinel() {
  const [events,          setEvents]         = useState([])
  const [alerts,          setAlerts]         = useState([])
  const [ticker,          setTicker]         = useState([])
  const [rawData,         setRawData]        = useState({
    summary: {},
    domains: [],
    sources: [],
    events: [],
    matchingEvents: 0,
    limit: 100,
    offset: 0,
    dbMissing: false,
  })
  const [selectedAlertId, setSelectedAlertId]= useState(null)
  const [running,         setRunning]        = useState(false)
  const [params,          setParams]         = useState(DEFAULT_PARAMS)
  const [sources,         setSources]        = useState({ cyber: true, physical: true, osint: true })
  const [totalIngested,   setTotalIngested]  = useState(0)
  const [liveMode,        setLiveMode]       = useState(false)
  const [liveError,       setLiveError]      = useState(null)
  const [engineRunning,   setEngineRunning]  = useState(false)

  const eventsRef  = useRef([])
  const alertsRef  = useRef([])
  const paramsRef  = useRef(params)
  const sourcesRef = useRef(sources)
  const intervalRef= useRef(null)
  const pollRef    = useRef(null)
  const liveModeRef= useRef(liveMode)

  // Keep refs in sync
  useEffect(() => { paramsRef.current = params }, [params])
  useEffect(() => { sourcesRef.current = sources }, [sources])
  useEffect(() => { liveModeRef.current = liveMode }, [liveMode])

  const applySnapshot = useCallback(data => {
    const notesById = Object.fromEntries(
      alertsRef.current.map(a => [a.id, a.note ?? '']).filter(([, n]) => n),
    )
    const mergedAlerts = (data.alerts ?? []).map(a => ({
      ...a,
      note: notesById[a.id] ?? a.note ?? '',
    }))
    eventsRef.current = data.liveEvents ?? []
    alertsRef.current = mergedAlerts
    setEvents([...eventsRef.current])
    setAlerts([...mergedAlerts])
    setTicker((data.liveEvents ?? []).slice(0, 100))
    setTotalIngested((data.liveEvents ?? []).length)
    setLiveError(null)
  }, [])

  const pollOnce = useCallback(async () => {
    try {
      const data = await fetchSnapshot()
      applySnapshot(data)
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : 'Could not reach AURORA API')
    }
  }, [applySnapshot])

  const loadRawDataOnce = useCallback(async (options = {}) => {
    if (!auroraApiConfigured()) return
    try {
      const data = await fetchRawData(options)
      setRawData(data)
      setLiveError(null)
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : 'Could not reach AURORA API')
    }
  }, [])

  useEffect(() => {
    if (!auroraApiConfigured() || !liveMode) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return undefined
    }
    pollOnce()
    pollRef.current = setInterval(pollOnce, POLL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [liveMode, pollOnce])

  // ── Ingest a single event ───────────────────────────────────
  const ingestEvent = useCallback((ev) => {
    if (liveModeRef.current) return
    if (!sourcesRef.current[ev.type]) return

    eventsRef.current = [...eventsRef.current.slice(-499), ev]
    setEvents([...eventsRef.current])
    setTicker(prev => [ev, ...prev].slice(0, 100))
    setTotalIngested(n => n + 1)

    runCorrelation()
  }, [])

  // ── Run correlation engine ──────────────────────────────────
  const runCorrelation = useCallback(() => {
    if (liveModeRef.current) return
    const newIncidents = correlateEvents(eventsRef.current, paramsRef.current)

    // Merge with existing alerts — preserve llmData, update events/score
    const merged = newIncidents.map(inc => {
      const existing = alertsRef.current.find(a => a.region === inc.region)
      if (existing) {
        return { ...existing, events: inc.events, score: inc.score, updatedAt: inc.updatedAt }
      }
      // New incident — kick off LLM synthesis
      triggerLLM(inc)
      return inc
    })

    alertsRef.current = merged
    setAlerts([...merged])
  }, [])

  // ── LLM synthesis (async, updates alert in place) ──────────
  const triggerLLM = useCallback(async (incident) => {
    if (liveModeRef.current) return

    // Mark as loading
    const setLoading = (loading) => {
      alertsRef.current = alertsRef.current.map(a =>
        a.region === incident.region ? { ...a, llmLoading: loading } : a
      )
      setAlerts([...alertsRef.current])
    }

    setLoading(true)

    const llmData = await synthesizeAlert(incident, paramsRef.current)

    alertsRef.current = alertsRef.current.map(a =>
      a.region === incident.region ? { ...a, llmData, llmLoading: false } : a
    )
    setAlerts([...alertsRef.current])
  }, [])

  // ── Feed start/stop ─────────────────────────────────────────
  const startFeed = useCallback(() => {
    if (liveModeRef.current) return
    if (intervalRef.current) return
    intervalRef.current = setInterval(() => {
      const type = pick(TYPES)
      ingestEvent(makeEvent(type))
    }, 2200)
    setRunning(true)
  }, [ingestEvent])

  const stopFeed = useCallback(() => {
    clearInterval(intervalRef.current)
    intervalRef.current = null
    setRunning(false)
  }, [])

  const toggleFeed = useCallback(() => {
    running ? stopFeed() : startFeed()
  }, [running, startFeed, stopFeed])

  // ── Load a scenario ─────────────────────────────────────────
  const loadScenario = useCallback((scenarioEvents) => {
    if (liveModeRef.current) return
    stopFeed()
    eventsRef.current  = []
    alertsRef.current  = []
    setEvents([])
    setAlerts([])
    setTicker([])
    setSelectedAlertId(null)
    setTotalIngested(0)

    // Ingest scenario events with a small stagger
    scenarioEvents.forEach((ev, i) => {
      setTimeout(() => ingestEvent(ev), i * 150)
    })
  }, [stopFeed, ingestEvent])

  // ── Clear all data ──────────────────────────────────────────
  const clearAll = useCallback(() => {
    if (liveModeRef.current) return
    stopFeed()
    eventsRef.current = []
    alertsRef.current = []
    setEvents([])
    setAlerts([])
    setTicker([])
    setSelectedAlertId(null)
    setTotalIngested(0)
  }, [stopFeed])

  // ── Update a correlation param ──────────────────────────────
  const updateParam = useCallback((key, value) => {
    setParams(p => {
      const next = { ...p, [key]: value }
      paramsRef.current = next
      return next
    })
    setTimeout(runCorrelation, 0)
  }, [runCorrelation])

  // ── Toggle a data source ────────────────────────────────────
  const toggleSource = useCallback((src) => {
    setSources(s => {
      const next = { ...s, [src]: !s[src] }
      sourcesRef.current = next
      return next
    })
  }, [])

  // ── Update analyst note on an alert ────────────────────────
  const updateNote = useCallback((alertId, note) => {
    alertsRef.current = alertsRef.current.map(a =>
      a.id === alertId ? { ...a, note } : a
    )
    setAlerts([...alertsRef.current])
  }, [])

  const toggleLiveMode = useCallback(() => {
    if (!auroraApiConfigured()) return
    stopFeed()
    setLiveMode(m => {
      const next = !m
      if (!next) setLiveError(null)
      return next
    })
  }, [stopFeed])

  const refreshLive = useCallback(() => {
    if (liveModeRef.current) pollOnce()
  }, [pollOnce])

  const refreshRawData = useCallback((options = {}) => {
    loadRawDataOnce(options)
  }, [loadRawDataOnce])

  const runBackendEngine = useCallback(async () => {
    if (!auroraApiConfigured()) return
    setEngineRunning(true)
    setLiveError(null)
    try {
      await runEngineOnServer()
      await pollOnce()
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : 'Engine run failed')
    } finally {
      setEngineRunning(false)
    }
  }, [pollOnce])

  // ── Cleanup on unmount ──────────────────────────────────────
  useEffect(() => () => clearInterval(intervalRef.current), [])

  // Computed stats
  const stats = {
    activeIncidents: alerts.length,
    highConfidence:  alerts.filter(a => a.score >= 70).length,
    rawEvents:       totalIngested,
    affectedRegions: new Set(alerts.map(a => a.region)).size,
  }

  return {
    events, alerts, ticker, stats,
    selectedAlertId, setSelectedAlertId,
    running, params, sources,
    toggleFeed, loadScenario, clearAll,
    updateParam, toggleSource, updateNote,
    ingestEvent,
    liveMode,
    liveError,
    rawData,
    liveApiAvailable: auroraApiConfigured(),
    toggleLiveMode,
    refreshLive,
    refreshRawData,
    runBackendEngine,
    engineRunning,
  }
}
