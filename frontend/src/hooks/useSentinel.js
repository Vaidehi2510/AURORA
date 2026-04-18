import { useState, useEffect, useRef, useCallback } from 'react'
import { makeEvent } from '../data/eventGenerator.js'
import { correlateEvents } from '../engine/correlationEngine.js'
import { synthesizeAlert } from '../engine/llmSynthesis.js'
import { DEFAULT_PARAMS, EVENT_TYPES } from '../data/constants.js'

const pick = arr => arr[Math.floor(Math.random() * arr.length)]
const TYPES = Object.values(EVENT_TYPES)

export function useSentinel() {
  const [events,          setEvents]         = useState([])
  const [alerts,          setAlerts]         = useState([])
  const [ticker,          setTicker]         = useState([])
  const [selectedAlertId, setSelectedAlertId]= useState(null)
  const [running,         setRunning]        = useState(false)
  const [params,          setParams]         = useState(DEFAULT_PARAMS)
  const [sources,         setSources]        = useState({ cyber: true, physical: true, osint: true, llm: true })
  const [totalIngested,   setTotalIngested]  = useState(0)

  const eventsRef  = useRef([])
  const alertsRef  = useRef([])
  const paramsRef  = useRef(params)
  const sourcesRef = useRef(sources)
  const intervalRef= useRef(null)

  // Keep refs in sync
  useEffect(() => { paramsRef.current = params }, [params])
  useEffect(() => { sourcesRef.current = sources }, [sources])

  // ── Ingest a single event ───────────────────────────────────
  const ingestEvent = useCallback((ev) => {
    if (!sourcesRef.current[ev.type]) return

    eventsRef.current = [...eventsRef.current.slice(-499), ev]
    setEvents([...eventsRef.current])
    setTicker(prev => [ev, ...prev].slice(0, 100))
    setTotalIngested(n => n + 1)

    runCorrelation()
  }, [])

  // ── Run correlation engine ──────────────────────────────────
  const runCorrelation = useCallback(() => {
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
    if (!sourcesRef.current.llm) return

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
  const updateNote = useCallback((region, note) => {
    alertsRef.current = alertsRef.current.map(a =>
      a.region === region ? { ...a, note } : a
    )
    setAlerts([...alertsRef.current])
  }, [])

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
  }
}
