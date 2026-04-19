import React, { useEffect, useRef, useState } from 'react'
import { apiUrl, getAuroraApiBase } from './api/auroraClient.js'
const RAW_PAGE_SIZE = 20

const ANALYST_FIELDS = [
  'analystVerdict',
  'analystConfidence',
  'analystEscalation',
  'analystNarrative',
  'analystGaps',
  'analystActions',
  'analystRanAt',
]

const COLORS = {
  bg: '#010608',
  card: 'rgba(8,20,35,0.85)',
  cardSoft: 'rgba(8,20,35,0.8)',
  border: 'rgba(52,211,153,0.1)',
  text: '#f1f5f9',
  secondary: '#cbd5e1',
  muted: '#94a3b8',
  dim: '#64748b',
  slate: '#475569',
  green: '#34d399',
  emerald: '#10b981',
  purple: '#a78bfa',
  violet: '#7c3aed',
  blue: '#60a5fa',
  electric: '#3b82f6',
  red: '#ef4444',
  amber: '#f59e0b',
  indigo: '#818cf8',
}

const DOMAIN_STYLES = {
  cyber: { dot: COLORS.blue, pillBg: 'rgba(96,165,250,0.12)', pillText: COLORS.blue },
  physical: { dot: COLORS.green, pillBg: 'rgba(52,211,153,0.12)', pillText: COLORS.green },
  osint: { dot: COLORS.purple, pillBg: 'rgba(167,139,250,0.14)', pillText: COLORS.purple },
}

const KB_SOURCES = [
  { name: 'AIID', color: COLORS.purple, description: 'AI incident database' },
  { name: 'ATT&CK ICS', color: COLORS.blue, description: 'ICS attack techniques' },
  { name: 'CISA ICS', color: COLORS.green, description: 'Gov advisories' },
  { name: 'CISA KEV', color: COLORS.amber, description: 'Known exploits' },
  { name: 'GDELT', color: COLORS.indigo, description: 'Global news feed' },
  { name: 'META VISION', color: COLORS.emerald, description: 'Camera anomalies' },
]

const OFFLINE_THREAD = [
  {
    id: 'offline-1',
    role: 'assistant',
    time: '--:--:--',
    body: 'Analyst chat is offline. The backend is reachable, but the LLM layer is not configured or not responding.',
  },
  {
    id: 'offline-2',
    role: 'user',
    time: '--:--:--',
    body: 'What should operators validate first?',
  },
  {
    id: 'offline-3',
    role: 'assistant',
    time: '--:--:--',
    body: 'Verify the selected alert evidence, review the raw event rows below, and run the analyst pass after the correlation engine finishes.',
  },
]

function App() {
  const [liveEvents, setLiveEvents] = useState([])
  const [feedEvents, setFeedEvents] = useState([])
  const [alerts, setAlerts] = useState([])
  const [selectedAlertId, setSelectedAlertId] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [errorState, setErrorState] = useState('')

  const [rawData, setRawData] = useState({
    summary: {},
    domains: [],
    sources: [],
    events: [],
    matchingEvents: 0,
    limit: RAW_PAGE_SIZE,
    offset: 0,
    dbMissing: false,
  })
  const [domainFilter, setDomainFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [rawPage, setRawPage] = useState(0)
  const [rawLoading, setRawLoading] = useState(false)

  const [serviceStatus, setServiceStatus] = useState({
    loaded: false,
    chatConfigured: false,
    chatModel: '',
    voiceTts: false,
    voiceStt: false,
    ttsModel: '',
    sttModel: '',
    voiceId: '',
  })
  const [engineState, setEngineState] = useState({ engineRunning: false, analystRunning: false })
  const [playbackState, setPlaybackState] = useState({ status: 'idle', scope: null, key: null })
  const [chatMessages, setChatMessages] = useState([])
  const [chatDraft, setChatDraft] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [transcriptMeta, setTranscriptMeta] = useState(null)
  const [autoSpeak, setAutoSpeak] = useState(true)
  const [autoSendVoice, setAutoSendVoice] = useState(true)
  const [liveFeedActive, setLiveFeedActive] = useState(false)
  const [liveFeedStarted, setLiveFeedStarted] = useState(false)

  const allAlertsRef = useRef([])
  const liveEventsRef = useRef([])
  const analystMapRef = useRef({})
  const seenAlertIdsRef = useRef(new Set())
  const seenLiveEventIdsRef = useRef(new Set())
  const streamedEventIdsRef = useRef(new Set())
  const liveEventQueueRef = useRef([])
  const liveFeedInitializedRef = useRef(false)
  const liveFeedStartedRef = useRef(false)
  const notificationTimersRef = useRef(new Map())
  const audioRef = useRef(null)
  const audioUrlRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const chunksRef = useRef([])
  const chatThreadRef = useRef(null)
  const rawRequestIdRef = useRef(0)

  const selectedAlert = alerts.find((alert) => alert.id === selectedAlertId) || null
  const criticalCount = alerts.filter((alert) => Number(alert.score || 0) >= 80).length
  const topScore = alerts.length ? Math.max(...alerts.map((alert) => Number(alert.score || 0))) : 0
  const physicalEvents = liveEvents.filter((event) => inferDomain(event) === 'physical').slice(0, 6)
  const activeNotifications = notifications.slice(0, 4)
  const rawSummary = rawData.summary || {}
  const rawDomains = Array.isArray(rawData.domains) ? rawData.domains : []
  const rawSources = Array.isArray(rawData.sources) ? rawData.sources : []
  const rawEvents = Array.isArray(rawData.events) ? rawData.events : []
  const rawLimit = Number(rawData.limit || RAW_PAGE_SIZE)
  const rawTotalPages = Math.max(Math.ceil(Number(rawData.matchingEvents || 0) / rawLimit), 1)
  const chatReady = serviceStatus.loaded && serviceStatus.chatConfigured
  const voiceReady = serviceStatus.loaded && (serviceStatus.voiceTts || serviceStatus.voiceStt)
  const displayedMessages = chatReady ? chatMessages : OFFLINE_THREAD
  const latestAssistant = [...chatMessages].reverse().find((message) => message.role === 'assistant') || null
  const liveFeedButtonLabel = !liveFeedStarted ? 'Run live feed' : liveFeedActive ? 'Pause live feed' : 'Resume live feed'

  const removeNotification = (notificationId) => {
    const timer = notificationTimersRef.current.get(notificationId)
    if (timer) {
      window.clearTimeout(timer)
      notificationTimersRef.current.delete(notificationId)
    }
    setNotifications((current) => current.filter((item) => item.notificationId !== notificationId))
  }

  const enqueueNotification = (alert) => {
    const notificationId = `${alert.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setNotifications((current) => [{ notificationId, alert }, ...current].slice(0, 6))
    const timer = window.setTimeout(() => removeNotification(notificationId), 8000)
    notificationTimersRef.current.set(notificationId, timer)
  }

  const detectNewAlerts = (nextAlerts) => {
    nextAlerts.forEach((alert) => {
      if (!seenAlertIdsRef.current.has(alert.id)) {
        seenAlertIdsRef.current.add(alert.id)
        enqueueNotification(alert)
      }
    })
  }

  const syncVisibleAlerts = (candidateAlerts = allAlertsRef.current) => {
    if (!liveFeedStartedRef.current) {
      setAlerts([])
      setSelectedAlertId(null)
      return []
    }

    const visibleAlerts = sortAlerts(
      candidateAlerts.filter((alert) => shouldRevealAlert(alert, streamedEventIdsRef.current)),
    )

    detectNewAlerts(visibleAlerts)
    setAlerts(visibleAlerts)
    setSelectedAlertId((currentId) => pickSelectedAlertId(currentId, visibleAlerts))
    return visibleAlerts
  }

  const refillLiveFeedQueue = () => {
    const candidates = buildStreamCandidates(liveEventsRef.current, allAlertsRef.current)
    if (!candidates.length) {
      return false
    }
    liveEventQueueRef.current = candidates.slice().reverse()
    return true
  }

  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current = null
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
    setPlaybackState({ status: 'idle', scope: null, key: null })
  }

  const stopMediaStream = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }

  const loadAnalystVerdicts = async () => {
    const response = await fetch(apiUrl('/api/analyst-verdicts'))
    if (!response.ok) {
      throw new Error(`Analyst verdict fetch failed with ${response.status}`)
    }

    const payload = await response.json()
    const nextMap = buildAnalystMap(payload)
    analystMapRef.current = nextMap
    allAlertsRef.current = sortAlerts(
      allAlertsRef.current.map((alert) => mergeAlertAnalyst(alert, nextMap[alert.id])),
    )
    syncVisibleAlerts(allAlertsRef.current)
    return nextMap
  }

  const loadSnapshot = async () => {
    const response = await fetch(apiUrl('/api/snapshot'))
    if (!response.ok) {
      throw new Error(`Snapshot fetch failed with ${response.status}`)
    }

    const payload = await response.json()
    const nextLiveEvents = sortEvents(Array.isArray(payload?.liveEvents) ? payload.liveEvents : [])
    const nextAlerts = buildResolvedAlerts(
      Array.isArray(payload?.alerts) ? payload.alerts : [],
      nextLiveEvents,
      analystMapRef.current,
    )
    allAlertsRef.current = nextAlerts

    const streamCandidates = buildStreamCandidates(nextLiveEvents, nextAlerts)
    const nextFeedItems = []
    streamCandidates.forEach((event) => {
      const eventId = String(event?.id ?? '')
      if (!eventId) {
        return
      }
      if (!seenLiveEventIdsRef.current.has(eventId)) {
        seenLiveEventIdsRef.current.add(eventId)
        nextFeedItems.push(event)
      }
    })

    if (!liveFeedInitializedRef.current) {
      liveFeedInitializedRef.current = true
      liveEventQueueRef.current = streamCandidates.slice().reverse()
    } else if (nextFeedItems.length > 0) {
      liveEventQueueRef.current.push(...nextFeedItems.reverse())
    }

    liveEventsRef.current = nextLiveEvents
    setLiveEvents(nextLiveEvents)
    setLastUpdated(new Date())
    syncVisibleAlerts(nextAlerts)
    setErrorState('')
    return { liveEvents: nextLiveEvents, alerts: nextAlerts }
  }

  const loadRawData = async () => {
    const requestId = Date.now() + Math.random()
    rawRequestIdRef.current = requestId
    setRawLoading(true)

    const params = new URLSearchParams()
    params.set('scope', scopeFilter)
    params.set('domain', domainFilter)
    params.set('search', searchText.trim())
    params.set('offset', String(rawPage * rawLimit))
    params.set('limit', String(rawLimit))

    try {
      const response = await fetch(apiUrl(`/api/raw-data?${params.toString()}`))
      if (!response.ok) {
        throw new Error(`Raw data fetch failed with ${response.status}`)
      }
      const payload = await response.json()
      if (rawRequestIdRef.current === requestId) {
        setRawData({
          summary: payload.summary || {},
          domains: Array.isArray(payload.domains) ? payload.domains : [],
          sources: Array.isArray(payload.sources) ? payload.sources : [],
          events: Array.isArray(payload.events) ? payload.events : [],
          matchingEvents: Number(payload.matchingEvents || 0),
          limit: Number(payload.limit || rawLimit),
          offset: Number(payload.offset || 0),
          dbMissing: Boolean(payload.dbMissing),
        })
      }
    } catch (error) {
      setErrorState(error.message || 'Raw data feed unavailable')
    } finally {
      if (rawRequestIdRef.current === requestId) {
        setRawLoading(false)
      }
    }
  }

  const loadServiceStatus = async () => {
    const [chatResult, voiceResult] = await Promise.allSettled([
      fetchJson('/api/analyst-chat/status'),
      fetchJson('/api/voice/status'),
    ])

    const nextStatus = {
      loaded: true,
      chatConfigured: chatResult.status === 'fulfilled' ? Boolean(chatResult.value?.configured) : false,
      chatModel: chatResult.status === 'fulfilled' ? String(chatResult.value?.model || '') : '',
      voiceTts: voiceResult.status === 'fulfilled' ? Boolean(voiceResult.value?.tts) : false,
      voiceStt: voiceResult.status === 'fulfilled' ? Boolean(voiceResult.value?.stt) : false,
      ttsModel: voiceResult.status === 'fulfilled' ? String(voiceResult.value?.ttsModel || '') : '',
      sttModel: voiceResult.status === 'fulfilled' ? String(voiceResult.value?.sttModel || '') : '',
      voiceId: voiceResult.status === 'fulfilled' ? String(voiceResult.value?.voiceId || '') : '',
    }

    setServiceStatus(nextStatus)
    if (nextStatus.chatConfigured) {
      setChatMessages((current) =>
        current.length
          ? current
          : [
              {
                id: uid(),
                role: 'assistant',
                time: nowTime(),
                body:
                  'OpenRouter is connected. Ask about the selected alert, contributing evidence, likely escalation paths, or verification steps. Voice capture and playback are available when the voice services are online.',
              },
            ],
      )
    }
  }

  const playText = async (text, scope, key) => {
    const cleaned = cleanDisplayText(text)
    if (!cleaned || !serviceStatus.voiceTts) {
      return
    }

    try {
      stopPlayback()
      setVoiceError('')
      setPlaybackState({ status: 'loading', scope, key })

      const response = await fetch(apiUrl('/api/voice/speak'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleaned }),
      })

      if (!response.ok) {
        throw new Error(`Voice synthesis failed with ${response.status}`)
      }

      const audioBlob = await response.blob()
      const audioUrl = URL.createObjectURL(audioBlob)
      const audio = new Audio(audioUrl)

      audioRef.current = audio
      audioUrlRef.current = audioUrl
      setPlaybackState({ status: 'playing', scope, key })

      audio.onended = () => stopPlayback()
      audio.onerror = () => {
        stopPlayback()
        setVoiceError('Audio playback failed in the browser.')
      }

      await audio.play()
    } catch (error) {
      stopPlayback()
      setVoiceError(error.message || 'Voice synthesis unavailable')
    }
  }

  const handleSpeakAlert = async (alert) => {
    if (!alert) {
      return
    }
    await playText(buildVoiceScript(alert), 'alert', alert.id)
  }

  const sendChatMessage = async (overrideText) => {
    const text = cleanDisplayText(overrideText !== undefined ? overrideText : chatDraft)
    if (!text || chatSending || !chatReady) {
      return
    }

    const userMessage = { id: uid(), role: 'user', time: nowTime(), body: text }
    const apiMessages = toApiMessages(chatMessages, text)

    setChatDraft('')
    setChatSending(true)
    setChatError('')
    setVoiceError('')
    setChatMessages((current) => [...current, userMessage])

    try {
      const response = await fetch(apiUrl('/api/analyst-chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          context: buildAnalystBoardContext(selectedAlert, alerts, liveEvents, rawSummary),
        }),
      })

      if (!response.ok) {
        const detail = await extractErrorDetail(response, `Analyst chat failed (${response.status})`)
        throw new Error(detail)
      }

      const payload = await response.json()
      const reply = String(payload.reply || '').trim() || 'No analyst response returned.'

      setChatMessages((current) => [
        ...current,
        { id: uid(), role: 'assistant', time: nowTime(), body: reply },
      ])

      if (autoSpeak && serviceStatus.voiceTts) {
        void playText(reply, 'chat', `assistant-${Date.now()}`)
      }
    } catch (error) {
      setChatError(error.message || 'Analyst chat failed')
    } finally {
      setChatSending(false)
    }
  }

  const transcribeBlob = async (blob) => {
    if (!serviceStatus.voiceStt) {
      return
    }

    setVoiceError('')
    setTranscriptMeta(null)
    setTranscribing(true)

    try {
      const formData = new FormData()
      formData.append('file', blob, 'aurora-voice.webm')
      formData.append('context_json', JSON.stringify(buildVoiceContext(selectedAlert, alerts, liveEvents)))

      const response = await fetch(apiUrl('/api/voice/transcribe'), {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const detail = await extractErrorDetail(response, `Voice transcription failed (${response.status})`)
        throw new Error(detail)
      }

      const payload = await response.json()
      const incoming = cleanDisplayText(payload.text || '')
      setTranscriptMeta(payload)

      if (!incoming) {
        return
      }

      if (autoSendVoice && chatReady) {
        setChatDraft(incoming)
        void sendChatMessage(incoming)
      } else {
        setChatDraft((current) => (current.trim() ? `${current.trim()} ${incoming}` : incoming))
      }
    } catch (error) {
      setVoiceError(error.message || 'Voice transcription unavailable')
    } finally {
      setTranscribing(false)
    }
  }

  const startRecording = async () => {
    if (!serviceStatus.voiceStt || recording || transcribing) {
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Microphone capture is not supported in this browser.')
      return
    }

    stopPlayback()
    setVoiceError('')
    setTranscriptMeta(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      mediaStreamRef.current = stream
      chunksRef.current = []
      const mimeType = pickSupportedMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        setVoiceError('Microphone recording failed.')
        setRecording(false)
        stopMediaStream()
      }

      recorder.onstop = () => {
        setRecording(false)
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
        chunksRef.current = []
        stopMediaStream()
        if (blob.size > 0) {
          void transcribeBlob(blob)
        } else {
          setVoiceError('No audio was captured.')
        }
      }

      recorder.start()
      setRecording(true)
    } catch (error) {
      stopMediaStream()
      setRecording(false)
      setVoiceError(error.message || 'Microphone access denied')
    }
  }

  const stopRecording = () => {
    if (!mediaRecorderRef.current) {
      return
    }
    try {
      mediaRecorderRef.current.stop()
    } catch {
      setRecording(false)
      stopMediaStream()
    }
  }

  const runEngine = async () => {
    setEngineState((current) => ({ ...current, engineRunning: true }))
    setErrorState('')

    try {
      const response = await fetch(apiUrl('/api/run-engine'), { method: 'POST' })
      if (!response.ok) {
        const detail = await extractErrorDetail(response, `Engine run failed (${response.status})`)
        throw new Error(detail)
      }
      await Promise.all([loadSnapshot(), loadRawData(), loadAnalystVerdicts().catch(() => null)])
    } catch (error) {
      setErrorState(error.message || 'Correlation engine run failed')
    } finally {
      setEngineState((current) => ({ ...current, engineRunning: false }))
    }
  }

  const runAnalystPass = async () => {
    setEngineState((current) => ({ ...current, analystRunning: true }))
    setErrorState('')

    try {
      const response = await fetch(apiUrl('/api/run-analyst'), { method: 'POST' })
      if (!response.ok) {
        const detail = await extractErrorDetail(response, `Analyst run failed (${response.status})`)
        throw new Error(detail)
      }
      await Promise.all([loadAnalystVerdicts(), loadSnapshot()])
    } catch (error) {
      setErrorState(error.message || 'Analyst run failed')
    } finally {
      setEngineState((current) => ({ ...current, analystRunning: false }))
    }
  }

  const toggleLiveFeed = () => {
    if (!liveEvents.length && !allAlertsRef.current.length && liveEventQueueRef.current.length === 0) {
      setErrorState(
        `No live snapshot data yet (API base: ${getAuroraApiBase()}). Ensure the backend is running and refresh.`,
      )
      return
    }

    if (!liveFeedStarted) {
      liveFeedStartedRef.current = true
      setLiveFeedStarted(true)
      setLiveFeedActive(true)
      if (!liveEventQueueRef.current.length) {
        refillLiveFeedQueue()
      }
      return
    }
    setLiveFeedActive((current) => !current)
  }

  const resetLiveFeed = () => {
    liveFeedStartedRef.current = false
    setLiveFeedActive(false)
    setLiveFeedStarted(false)
    setFeedEvents([])
    setAlerts([])
    setSelectedAlertId(null)
    setNotifications([])
    streamedEventIdsRef.current = new Set()
    seenAlertIdsRef.current = new Set()
    notificationTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    notificationTimersRef.current.clear()
    refillLiveFeedQueue()
  }

  useEffect(() => {
    let active = true

    const bootstrap = async () => {
      try {
        await Promise.all([
          loadServiceStatus().catch(() => null),
          loadAnalystVerdicts().catch(() => null),
          loadSnapshot(),
          loadRawData(),
        ])
      } catch (error) {
        if (active) {
          setErrorState(error.message || 'AURORA bootstrap failed')
        }
      }
    }

    const snapshotTick = async () => {
      if (!active) {
        return
      }
      try {
        await loadSnapshot()
      } catch (error) {
        if (active) {
          setErrorState(error.message || 'Snapshot feed unavailable')
        }
      }
    }

    const verdictTick = async () => {
      if (!active) {
        return
      }
      try {
        await loadAnalystVerdicts()
      } catch (error) {
        if (active) {
          setErrorState(error.message || 'Analyst verdict feed unavailable')
        }
      }
    }

    bootstrap()

    const snapshotInterval = window.setInterval(snapshotTick, 10000)
    const verdictInterval = window.setInterval(verdictTick, 30000)
    const statusInterval = window.setInterval(() => {
      if (active) {
        loadServiceStatus().catch(() => null)
      }
    }, 60000)

    return () => {
      active = false
      window.clearInterval(snapshotInterval)
      window.clearInterval(verdictInterval)
      window.clearInterval(statusInterval)
      notificationTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      notificationTimersRef.current.clear()
      stopPlayback()
      stopMediaStream()
    }
  }, [])

  useEffect(() => {
    setRawPage(0)
  }, [domainFilter, scopeFilter, searchText])

  useEffect(() => {
    let active = true

    const fetchRawView = async () => {
      try {
        await loadRawData()
      } catch (error) {
        if (active) {
          setErrorState(error.message || 'Raw data feed unavailable')
        }
      }
    }

    fetchRawView()
    const rawInterval = window.setInterval(fetchRawView, 30000)

    return () => {
      active = false
      window.clearInterval(rawInterval)
    }
  }, [domainFilter, scopeFilter, searchText, rawPage])

  useEffect(() => {
    const element = chatThreadRef.current
    if (element) {
      element.scrollTop = element.scrollHeight
    }
  }, [displayedMessages, chatSending])

  useEffect(() => {
    if (!liveFeedActive) {
      return undefined
    }

    const feedInterval = window.setInterval(() => {
      if (!liveEventQueueRef.current.length) {
        const refilled = refillLiveFeedQueue()
        if (!refilled) {
          return
        }
      }

      const nextEvent = liveEventQueueRef.current.shift()
      if (!nextEvent) {
        return
      }

      const eventId = String(nextEvent?.id ?? '')
      if (eventId) {
        streamedEventIdsRef.current.add(eventId)
      }

      setFeedEvents((current) => [nextEvent, ...current].slice(0, 100))
      syncVisibleAlerts(allAlertsRef.current)
    }, 900)

    return () => {
      window.clearInterval(feedInterval)
    }
  }, [liveFeedActive, liveFeedStarted])

  const maxDomainCount = Math.max(...rawDomains.map((item) => Number(item.count || 0)), 1)
  const voiceButtonState =
    playbackState.scope === 'alert' && playbackState.key === selectedAlert?.id
      ? playbackState.status
      : 'idle'

  return (
    <div
      style={{
        height: '100vh',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: COLORS.bg,
        color: COLORS.text,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

        @keyframes fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }

        @keyframes slide-in {
          from { opacity: 0; transform: translateX(120%); }
          to { opacity: 1; transform: translateX(0); }
        }

        @keyframes ecg-draw {
          from { stroke-dashoffset: 300; }
          to { stroke-dashoffset: 0; }
        }

        @keyframes aurora-shift {
          0% { opacity: 0.5; transform: scaleX(1) translateX(0); }
          50% { opacity: 0.85; transform: scaleX(1.05) translateX(-2%); }
          100% { opacity: 0.58; transform: scaleX(0.98) translateX(1.5%); }
        }

        * { box-sizing: border-box; }

        .aurora-shell {
          position: relative;
          z-index: 1;
          min-height: 100vh;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          font-family: 'Inter', sans-serif;
        }

        .aurora-header-grid {
          display: grid;
          grid-template-columns: minmax(260px, 1fr) 240px minmax(320px, 1fr);
          gap: 20px;
          align-items: center;
        }

        .aurora-stat-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }

        .aurora-main-grid {
          display: grid;
          grid-template-columns: 320px minmax(0, 1fr) 280px;
          gap: 16px;
          align-items: start;
        }

        .aurora-data-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
          gap: 16px;
        }

        .aurora-notifications {
          position: fixed;
          top: 104px;
          right: 24px;
          width: min(360px, calc(100vw - 32px));
          display: flex;
          flex-direction: column;
          gap: 12px;
          z-index: 100;
          pointer-events: none;
        }

        .aurora-notification-card {
          pointer-events: auto;
          animation: slide-in 0.35s ease;
        }

        .aurora-fade-up {
          animation: fade-up 0.3s ease;
        }

        .aurora-panel-scroll::-webkit-scrollbar,
        .aurora-table-wrap::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        .aurora-panel-scroll::-webkit-scrollbar-thumb,
        .aurora-table-wrap::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.22);
          border-radius: 999px;
        }

        @media (max-width: 1380px) {
          .aurora-main-grid {
            grid-template-columns: 320px minmax(0, 1fr);
          }

          .aurora-right-column {
            grid-column: 1 / -1;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px;
          }

        }

        @media (max-width: 1180px) {
          .aurora-header-grid,
          .aurora-main-grid,
          .aurora-stat-grid,
          .aurora-data-grid,
          .aurora-right-column {
            grid-template-columns: minmax(0, 1fr);
          }
        }

        @media (max-width: 960px) {
          .aurora-shell {
            padding: 16px;
          }

          .aurora-notifications {
            top: 88px;
            right: 16px;
          }
        }
      `}</style>

      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          overflow: 'hidden',
          background:
            'radial-gradient(circle at 20% 10%, rgba(59,130,246,0.10), transparent 28%), radial-gradient(circle at 80% 0%, rgba(124,58,237,0.10), transparent 30%), linear-gradient(180deg, rgba(1,6,8,0.94), #010608 65%)',
        }}
      >
        <svg width="100%" height="300" viewBox="0 0 1440 300" preserveAspectRatio="none" style={{ position: 'absolute', top: 0 }}>
          <defs>
            <linearGradient id="aurora-green" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(16,185,129,0)" />
              <stop offset="40%" stopColor="rgba(16,185,129,0.34)" />
              <stop offset="100%" stopColor="rgba(16,185,129,0)" />
            </linearGradient>
            <linearGradient id="aurora-blue" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(59,130,246,0)" />
              <stop offset="50%" stopColor="rgba(59,130,246,0.32)" />
              <stop offset="100%" stopColor="rgba(59,130,246,0)" />
            </linearGradient>
            <linearGradient id="aurora-purple" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(124,58,237,0)" />
              <stop offset="55%" stopColor="rgba(124,58,237,0.30)" />
              <stop offset="100%" stopColor="rgba(124,58,237,0)" />
            </linearGradient>
          </defs>
          <path
            d="M0 82C150 28 360 14 540 58C700 95 820 130 1010 98C1160 72 1300 14 1440 42V0H0Z"
            fill="url(#aurora-purple)"
            style={{ animation: 'aurora-shift 12s ease-in-out infinite', transformOrigin: 'center top' }}
          />
          <path
            d="M0 128C180 88 330 44 520 82C690 116 840 182 1010 164C1170 146 1295 102 1440 122V0H0Z"
            fill="url(#aurora-blue)"
            style={{ animation: 'aurora-shift 10s ease-in-out infinite', transformOrigin: 'center top' }}
          />
          <path
            d="M0 170C145 148 280 106 470 134C670 164 810 252 1032 218C1192 194 1294 124 1440 138V0H0Z"
            fill="url(#aurora-green)"
            style={{ animation: 'aurora-shift 8s ease-in-out infinite', transformOrigin: 'center top' }}
          />
        </svg>
      </div>

      <div className="aurora-shell">
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 50,
            padding: '14px 20px',
            background: 'rgba(1,6,8,0.7)',
            backdropFilter: 'blur(16px)',
            borderBottom: `1px solid ${COLORS.border}`,
            borderRadius: 16,
          }}
        >
          <div className="aurora-header-grid">
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: '"Cormorant Garamond", serif',
                  fontSize: 30,
                  fontWeight: 600,
                  letterSpacing: 8,
                  background: `linear-gradient(90deg, ${COLORS.purple}, ${COLORS.blue}, ${COLORS.green})`,
                  WebkitBackgroundClip: 'text',
                  color: 'transparent',
                  lineHeight: 1,
                }}
              >
                AURORA
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: '"Cormorant Garamond", serif',
                  fontStyle: 'italic',
                  fontSize: 12,
                  color: COLORS.dim,
                }}
              >
                Detect the signal. Before it becomes the storm.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <svg width="180" height="28" viewBox="0 0 160 28" fill="none">
                <defs>
                  <linearGradient id="ecg-gradient" x1="0" y1="0" x2="160" y2="0">
                    <stop offset="0%" stopColor="rgba(52,211,153,0.2)" />
                    <stop offset="40%" stopColor={COLORS.green} />
                    <stop offset="100%" stopColor="rgba(52,211,153,0.85)" />
                  </linearGradient>
                  <filter id="ecg-glow">
                    <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <path
                  d="M0 14 L30 14 L38 4 L46 24 L54 8 L62 18 L70 14 L160 14"
                  stroke="url(#ecg-gradient)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="300"
                  style={{ animation: 'ecg-draw 2s ease forwards' }}
                />
                <circle
                  cx="155"
                  cy="14"
                  r="4"
                  fill={COLORS.green}
                  filter="url(#ecg-glow)"
                  style={{ animation: 'pulse-dot 1.5s ease-in-out infinite' }}
                />
              </svg>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <StatusDot color={COLORS.green} size={10} />
                  <span
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 11,
                      letterSpacing: 2,
                      color: COLORS.green,
                    }}
                  >
                    LIVE
                  </span>
                  <span
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 11,
                      color: COLORS.muted,
                    }}
                  >
                    {lastUpdated ? `LAST ${formatTime(lastUpdated)}` : 'AWAITING SNAPSHOT'}
                  </span>
                  {criticalCount > 0 && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        borderRadius: 999,
                        background: 'rgba(239,68,68,0.12)',
                        border: '1px solid rgba(239,68,68,0.28)',
                        color: COLORS.red,
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 11,
                        animation: 'pulse-dot 1.5s ease-in-out infinite',
                      }}
                    >
                      {criticalCount} CRITICAL
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <DomainPill domain="cyber" label="CYBER" />
                  <DomainPill domain="physical" label="PHYSICAL" />
                  <DomainPill domain="osint" label="OSINT" />
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <StatusBadge label="CHAT" active={serviceStatus.chatConfigured} />
                  <StatusBadge label="TTS" active={serviceStatus.voiceTts} tone={COLORS.blue} />
                  <StatusBadge label="STT" active={serviceStatus.voiceStt} tone={COLORS.purple} />
                </div>
                {errorState && (
                  <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: COLORS.red }}>
                    {errorState}
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="aurora-stat-grid">
          <StatCard
            accent={COLORS.red}
            label="Active alerts"
            value={`${alerts.length}`}
            subLabel={criticalCount ? `${criticalCount} critical` : 'All clear'}
          />
          <StatCard
            accent={COLORS.amber}
            label="Top confidence"
            value={`${topScore}%`}
            subLabel="Highest correlated alert"
          />
          <StatCard
            accent={COLORS.green}
            label="Live signals"
            value={`${liveEvents.length}`}
            subLabel="Cyber · Physical · OSINT"
          />
          <StatCard
            accent={COLORS.purple}
            label="Knowledge base"
            value="3,500+"
            subLabel="AIID · ATT&CK · CISA · GDELT"
          />
        </div>

        <div className="aurora-main-grid">
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <SectionLabel>Correlated alerts</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alerts.length === 0 ? (
                <EmptyPanel text="Awaiting correlated alerts..." />
              ) : (
                alerts.map((alert) => {
                  const scoreTone = getScoreTone(Number(alert.score || 0))
                  const verdictTone = getVerdictTone(alert)
                  const alertDomains = getAlertDomains(alert)
                  const isSelected = alert.id === selectedAlertId
                  return (
                    <button
                      key={alert.id}
                      type="button"
                      onClick={() => setSelectedAlertId(alert.id)}
                      className="aurora-fade-up"
                      style={{
                        textAlign: 'left',
                        background: isSelected ? 'rgba(52,211,153,0.06)' : COLORS.cardSoft,
                        border: `1px solid ${isSelected ? 'rgba(52,211,153,0.3)' : 'rgba(52,211,153,0.08)'}`,
                        borderLeft: `3px solid ${scoreTone}`,
                        borderRadius: 10,
                        padding: '14px 16px',
                        cursor: 'pointer',
                        color: COLORS.text,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                        <div
                          style={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: 11,
                            color: COLORS.muted,
                            lineHeight: 1.6,
                          }}
                        >
                          <div>{alert.id}</div>
                          <div>{alert.region || 'Unspecified region'}</div>
                        </div>
                        <div
                          style={{
                            fontFamily: '"Cormorant Garamond", serif',
                            fontSize: 24,
                            fontWeight: 600,
                            color: scoreTone,
                            lineHeight: 1,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {Number(alert.score || 0)}%
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop: 10,
                          fontSize: 13,
                          fontWeight: 500,
                          color: COLORS.text,
                          lineHeight: 1.5,
                        }}
                      >
                        {alert.llmData?.headline || 'Analyst correlation pending'}
                      </div>

                      {alert.analystVerdict && (
                        <div
                          style={{
                            marginTop: 10,
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 8,
                            alignItems: 'center',
                          }}
                        >
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, color: verdictTone }}>
                            <StatusDot color={verdictTone} size={8} />
                            <span style={{ textTransform: 'uppercase', letterSpacing: 1.2 }}>
                              {alert.analystVerdict}
                            </span>
                          </div>
                          <span
                            style={{
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: 10,
                              color: COLORS.dim,
                              textTransform: 'uppercase',
                            }}
                          >
                            {alert.analystEscalation || 'No escalation'}
                          </span>
                        </div>
                      )}

                      <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {alertDomains.map((domain) => (
                          <DomainPill key={`${alert.id}-${domain}`} domain={domain} />
                        ))}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12,
                padding: 20,
              }}
            >
              {!selectedAlert ? (
                <div
                  style={{
                    minHeight: 520,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px dashed rgba(148,163,184,0.18)',
                    borderRadius: 12,
                    color: '#334155',
                    fontFamily: '"Cormorant Garamond", serif',
                    fontStyle: 'italic',
                    fontSize: 24,
                    textAlign: 'center',
                    padding: 24,
                  }}
                >
                  Select an alert to see the full analyst assessment
                </div>
              ) : (
                <AlertDetail
                  alert={selectedAlert}
                  onSpeak={handleSpeakAlert}
                  voiceButtonState={voiceButtonState}
                />
              )}
            </div>

            <section
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12,
                padding: 18,
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <SectionLabel>Analyst console</SectionLabel>
                  <div
                    style={{
                      marginTop: 10,
                      fontFamily: '"Cormorant Garamond", serif',
                      fontSize: 26,
                      fontWeight: 600,
                      color: COLORS.text,
                    }}
                  >
                    Ask the fusion desk
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: COLORS.dim, lineHeight: 1.7 }}>
                    Questions stay grounded in the selected alert, the live feed, and the database view below.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <ToggleChip
                    label={`Auto speak ${autoSpeak ? 'on' : 'off'}`}
                    active={autoSpeak}
                    onClick={() => setAutoSpeak((current) => !current)}
                    disabled={!serviceStatus.voiceTts}
                  />
                  <ToggleChip
                    label={`Auto send voice ${autoSendVoice ? 'on' : 'off'}`}
                    active={autoSendVoice}
                    onClick={() => setAutoSendVoice((current) => !current)}
                    disabled={!serviceStatus.voiceStt || !chatReady}
                  />
                </div>
              </div>

              <div
                ref={chatThreadRef}
                className="aurora-panel-scroll"
                style={{
                  marginTop: 18,
                  maxHeight: 320,
                  overflowY: 'auto',
                  paddingRight: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                {displayedMessages.map((message) => (
                  <div
                    key={message.id}
                    style={{
                      alignSelf: message.role === 'user' ? 'flex-end' : 'stretch',
                      marginLeft: message.role === 'user' ? '20%' : 0,
                      marginRight: message.role === 'user' ? 0 : '8%',
                      background:
                        message.role === 'user'
                          ? 'rgba(52,211,153,0.10)'
                          : message.role === 'assistant'
                            ? 'rgba(96,165,250,0.08)'
                            : 'rgba(167,139,250,0.08)',
                      border: `1px solid ${
                        message.role === 'user'
                          ? 'rgba(52,211,153,0.18)'
                          : message.role === 'assistant'
                            ? 'rgba(96,165,250,0.16)'
                            : 'rgba(167,139,250,0.18)'
                      }`,
                      borderRadius: 12,
                      padding: '12px 14px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                      <span
                        style={{
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: 10,
                          letterSpacing: 1.5,
                          textTransform: 'uppercase',
                          color: message.role === 'user' ? COLORS.green : message.role === 'assistant' ? COLORS.blue : COLORS.purple,
                        }}
                      >
                        {message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Analyst' : 'System'}
                      </span>
                      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: COLORS.dim }}>
                        {message.time}
                      </span>
                    </div>
                    <MessageBody body={message.body} />
                  </div>
                ))}

                {chatSending && (
                  <div
                    style={{
                      marginRight: '8%',
                      background: 'rgba(96,165,250,0.08)',
                      border: '1px solid rgba(96,165,250,0.16)',
                      borderRadius: 12,
                      padding: '12px 14px',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 11,
                      color: COLORS.blue,
                    }}
                  >
                    Analyst is assembling a response...
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'end' }}>
                <div>
                  <textarea
                    value={chatDraft}
                    onChange={(event) => setChatDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void sendChatMessage()
                      }
                    }}
                    placeholder={
                      chatReady
                        ? 'Ask about the selected alert, contributing signals, recommended response, or gaps in evidence...'
                        : 'Analyst chat is offline until the backend LLM service is available.'
                    }
                    disabled={!chatReady || chatSending}
                    style={{
                      width: '100%',
                      minHeight: 104,
                      resize: 'vertical',
                      borderRadius: 12,
                      border: '1px solid rgba(52,211,153,0.14)',
                      background: 'rgba(2,12,24,0.9)',
                      color: COLORS.secondary,
                      padding: 14,
                      fontFamily: 'Inter, sans-serif',
                      fontSize: 13,
                      lineHeight: 1.6,
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 164 }}>
                  <ActionButton
                    label={chatSending ? 'Sending...' : 'Send question'}
                    onClick={() => void sendChatMessage()}
                    disabled={!chatReady || chatSending || !cleanDisplayText(chatDraft)}
                    tone={COLORS.green}
                  />
                  <ActionButton
                    label={recording ? 'Stop recording' : transcribing ? 'Transcribing...' : 'Voice question'}
                    onClick={recording ? stopRecording : () => void startRecording()}
                    disabled={!serviceStatus.voiceStt || transcribing}
                    tone={COLORS.purple}
                  />
                  <ActionButton
                    label={
                      playbackState.scope === 'chat' && playbackState.status !== 'idle'
                        ? playbackState.status === 'loading'
                          ? 'Generating...'
                          : 'Speaking...'
                        : 'Speak latest reply'
                    }
                    onClick={() => latestAssistant && void playText(latestAssistant.body, 'chat', latestAssistant.id)}
                    disabled={!serviceStatus.voiceTts || !latestAssistant}
                    tone={COLORS.blue}
                  />
                </div>
              </div>

              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {chatError && <InlineNotice tone={COLORS.red} text={chatError} />}
                {voiceError && <InlineNotice tone={COLORS.amber} text={voiceError} />}
                {transcriptMeta?.text && (
                  <InlineNotice
                    tone={COLORS.purple}
                    text={`Transcript: ${cleanDisplayText(transcriptMeta.text)}`}
                  />
                )}
              </div>
            </section>
          </section>

          <aside className="aurora-right-column" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <Panel
              title={`Live signals${liveFeedStarted ? liveFeedActive ? ' · streaming' : ' · paused' : ' · standby'}`}
              color={COLORS.green}
              height={320}
              emptyText={liveFeedStarted ? 'Awaiting live signals...' : 'Press Run live feed to stream signals one by one.'}
            >
              {feedEvents.length === 0 ? null : (
                <div className="aurora-panel-scroll" style={{ maxHeight: 250, overflowY: 'auto', paddingRight: 4 }}>
                  {feedEvents.map((event, index) => {
                    const domain = inferDomain(event)
                    const domainStyle = DOMAIN_STYLES[domain]
                    return (
                      <div
                        key={event.id || `${event.title}-${index}`}
                        className={index === 0 ? 'aurora-fade-up' : undefined}
                        style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 999,
                              background: domainStyle.dot,
                              boxShadow: `0 0 14px ${domainStyle.dot}`,
                              flexShrink: 0,
                            }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 11,
                                color: COLORS.secondary,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {event.title || 'Untitled live event'}
                            </div>
                            <div
                              style={{
                                marginTop: 3,
                                fontFamily: '"JetBrains Mono", monospace',
                                fontSize: 10,
                                color: COLORS.slate,
                              }}
                            >
                              {formatEventType(event.type)} · {formatTimestamp(event.timestamp)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>

            <Panel title="Operations + services" color={COLORS.amber}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ActionButton
                  label={liveFeedButtonLabel}
                  onClick={toggleLiveFeed}
                  disabled={false}
                  tone={COLORS.green}
                />
                <ActionButton
                  label="Reset streamed feed"
                  onClick={resetLiveFeed}
                  disabled={!liveFeedStarted && !feedEvents.length}
                  tone={COLORS.purple}
                />
                <ActionButton
                  label={engineState.engineRunning ? 'Running correlation engine...' : 'Run correlation engine'}
                  onClick={() => void runEngine()}
                  disabled={engineState.engineRunning}
                  tone={COLORS.amber}
                />
                <ActionButton
                  label={engineState.analystRunning ? 'Running analyst pass...' : 'Run analyst pass'}
                  onClick={() => void runAnalystPass()}
                  disabled={engineState.analystRunning}
                  tone={COLORS.red}
                />
                <ActionButton
                  label={playbackState.status === 'idle' ? 'Stop voice playback' : 'Stop voice playback'}
                  onClick={stopPlayback}
                  disabled={playbackState.status === 'idle'}
                  tone={COLORS.blue}
                />
              </div>

              <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
                <MiniMetric label="Feed status" value={!liveFeedStarted ? 'Standby' : liveFeedActive ? 'Streaming' : 'Paused'} />
                <MiniMetric label="Streamed signals" value={formatCount(feedEvents.length)} />
                <MiniMetric label="DB live events" value={formatCount(rawSummary.live_events)} />
                <MiniMetric label="Historical events" value={formatCount(rawSummary.historical_events)} />
                <MiniMetric label="Unique sources" value={formatCount(rawSummary.unique_sources)} />
                <MiniMetric label="Latest DB row" value={formatTimestamp(rawSummary.latest_timestamp)} small />
              </div>

              <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <ServiceRow label="Analyst chat" active={serviceStatus.chatConfigured} detail={serviceStatus.chatModel} tone={COLORS.green} />
                <ServiceRow label="Voice TTS" active={serviceStatus.voiceTts} detail={serviceStatus.ttsModel} tone={COLORS.blue} />
                <ServiceRow label="Voice STT" active={serviceStatus.voiceStt} detail={serviceStatus.sttModel} tone={COLORS.purple} />
                <ServiceRow label="Voice ID" active={Boolean(serviceStatus.voiceId)} detail={serviceStatus.voiceId || 'Unavailable'} tone={COLORS.amber} />
              </div>

              {selectedAlert && (
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: 1.4 }}>
                    Selected alert
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: COLORS.secondary, lineHeight: 1.7 }}>
                    {selectedAlert.llmData?.headline || selectedAlert.region || 'Alert context'}
                  </div>
                  <div style={{ marginTop: 8, fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: COLORS.dim, lineHeight: 1.7 }}>
                    {selectedAlert.region || 'Unknown region'}
                    <br />
                    {Number(selectedAlert.score || 0)}% confidence · {Array.isArray(selectedAlert.events) ? selectedAlert.events.length : 0} signals
                  </div>
                </div>
              )}
            </Panel>

            <Panel
              title="Meta Vision · DINOv2 + SAM"
              color={COLORS.green}
              emptyText="Monitoring camera feeds — no anomalies detected"
            >
              {physicalEvents.length === 0 ? null : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                    {physicalEvents.map((event) => (
                      <div
                        key={event.id}
                        style={{
                          background: 'rgba(16,185,129,0.08)',
                          border: '1px solid rgba(52,211,153,0.14)',
                          borderRadius: 10,
                          padding: '10px 10px 12px',
                        }}
                      >
                        <div style={{ fontSize: 11, color: COLORS.secondary, lineHeight: 1.5 }}>
                          {event.title || 'Physical anomaly'}
                        </div>
                        <div
                          style={{
                            marginTop: 8,
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: 10,
                            color: COLORS.slate,
                            lineHeight: 1.6,
                          }}
                        >
                          {event.region || 'Unknown region'}
                          <br />
                          {formatTimestamp(event.timestamp)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ color: COLORS.dim, fontSize: 11, lineHeight: 1.6 }}>
                    DINOv2 scores each camera frame against a normal baseline. SAM 3.1 segments the anomalous object
                    using attention hotspots as prompt points. Physical events enter the correlation engine alongside
                    cyber and OSINT signals.
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Knowledge Base · 3,500+ incidents" color={COLORS.purple}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {KB_SOURCES.map((source) => (
                  <div key={source.name} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: source.color,
                        boxShadow: `0 0 10px ${source.color}`,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        minWidth: 90,
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 11,
                        color: source.color,
                      }}
                    >
                      {source.name}
                    </span>
                    <span style={{ fontSize: 11, color: COLORS.slate }}>{source.description}</span>
                  </div>
                ))}
                <div style={{ marginTop: 8, fontSize: 11, color: '#334155', lineHeight: 1.6 }}>
                  Semantic search via OpenAI ada-002 embeddings. Llama 3.3 70B produces the senior analyst assessment.
                </div>
              </div>
            </Panel>
          </aside>
        </div>

        <section
          style={{
            background: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: 18,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <SectionLabel>Data dashboard</SectionLabel>
              <div
                style={{
                  marginTop: 10,
                  fontFamily: '"Cormorant Garamond", serif',
                  fontSize: 26,
                  fontWeight: 600,
                  color: COLORS.text,
                }}
              >
                Unified event intelligence
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: COLORS.dim, lineHeight: 1.7 }}>
                Live view of the backend `unified_events` table with domain mix, source mix, and searchable event rows.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <FilterSelect value={domainFilter} onChange={setDomainFilter}>
                <option value="all">All domains</option>
                {rawDomains.map((item) => (
                  <option key={item.name} value={item.name}>
                    {String(item.name).toUpperCase()}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect value={scopeFilter} onChange={setScopeFilter}>
                <option value="all">All rows</option>
                <option value="live">Live only</option>
                <option value="historical">Historical only</option>
                <option value="simulated">Simulated only</option>
              </FilterSelect>
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search title, source, region..."
                style={{
                  minWidth: 240,
                  borderRadius: 999,
                  border: '1px solid rgba(52,211,153,0.14)',
                  background: 'rgba(2,12,24,0.9)',
                  color: COLORS.secondary,
                  padding: '10px 14px',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
            </div>
          </div>

          <div style={{ marginTop: 18 }} className="aurora-data-grid">
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
                <MiniStatCard label="Total events" value={formatCount(rawSummary.total_events)} accent={COLORS.blue} />
                <MiniStatCard label="Live rows" value={formatCount(rawSummary.live_events)} accent={COLORS.green} />
                <MiniStatCard label="Historical" value={formatCount(rawSummary.historical_events)} accent={COLORS.amber} />
                <MiniStatCard label="Simulated" value={formatCount(rawSummary.simulated_events)} accent={COLORS.purple} />
              </div>

              <div
                style={{
                  background: 'rgba(2,12,24,0.78)',
                  border: '1px solid rgba(52,211,153,0.08)',
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <SectionLabel>Raw event sample</SectionLabel>
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, color: COLORS.dim }}>
                    Showing <span style={{ color: COLORS.secondary }}>{formatCount(rawEvents.length)}</span> rows from{' '}
                    <span style={{ color: COLORS.secondary }}>{formatCount(rawData.matchingEvents)}</span> matching events.
                  </div>
                  <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: rawLoading ? COLORS.amber : COLORS.dim }}>
                    {rawLoading ? 'Refreshing database view...' : `Page ${rawPage + 1} of ${rawTotalPages}`}
                  </div>
                </div>

                {rawData.dbMissing ? (
                  <div style={{ marginTop: 18, fontStyle: 'italic', color: '#334155' }}>
                    `db/aurora.db` was not found by the API.
                  </div>
                ) : (
                  <>
                    <div className="aurora-table-wrap" style={{ marginTop: 14, overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                        <thead>
                          <tr>
                            {['Timestamp', 'Domain', 'Source', 'Title', 'Location', 'Flags'].map((heading) => (
                              <th
                                key={heading}
                                style={{
                                  textAlign: 'left',
                                  padding: '10px 10px 12px',
                                  fontFamily: '"JetBrains Mono", monospace',
                                  fontSize: 10,
                                  letterSpacing: 1.5,
                                  textTransform: 'uppercase',
                                  color: COLORS.dim,
                                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                                }}
                              >
                                {heading}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rawEvents.map((event) => {
                            const domain = String(event.domain || 'unknown').toLowerCase()
                            const domainStyle = DOMAIN_STYLES[domain] || DOMAIN_STYLES.cyber
                            return (
                              <tr key={`${event.id}-${event.timestampRaw || event.timestamp}`}>
                                <td style={tableCellStyle}>{formatTimestamp(event.timestamp)}</td>
                                <td style={tableCellStyle}>
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      padding: '4px 8px',
                                      borderRadius: 999,
                                      border: `1px solid ${domainStyle.pillText}33`,
                                      background: domainStyle.pillBg,
                                      color: domainStyle.pillText,
                                      fontFamily: '"JetBrains Mono", monospace',
                                      fontSize: 10,
                                      textTransform: 'uppercase',
                                    }}
                                  >
                                    {domain}
                                  </span>
                                </td>
                                <td style={tableCellStyle}>{event.source || 'Unknown'}</td>
                                <td style={tableCellStyle}>
                                  <div style={{ color: COLORS.secondary, fontSize: 12, lineHeight: 1.5 }}>
                                    {event.title || '(no title)'}
                                  </div>
                                  <div style={{ marginTop: 4, color: COLORS.dim, fontSize: 11 }}>
                                    {event.description || event.eventType || 'No detail'}
                                  </div>
                                </td>
                                <td style={tableCellStyle}>{event.region || 'Unknown'}</td>
                                <td style={tableCellStyle}>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    <TinyFlag text={event.severity || 'MED'} tone={getSeverityTone(event.severity)} />
                                    {event.isLive && <TinyFlag text="LIVE" tone={COLORS.green} />}
                                    {event.isSimulated && <TinyFlag text="SIM" tone={COLORS.purple} />}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 11, color: COLORS.dim }}>
                        Latest DB timestamp: {formatTimestamp(rawSummary.latest_timestamp)}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <ActionButton
                          label="Previous"
                          onClick={() => setRawPage((current) => Math.max(0, current - 1))}
                          disabled={rawPage === 0}
                          tone={COLORS.blue}
                          compact
                        />
                        <ActionButton
                          label="Next"
                          onClick={() => setRawPage((current) => Math.min(rawTotalPages - 1, current + 1))}
                          disabled={rawPage + 1 >= rawTotalPages}
                          tone={COLORS.green}
                          compact
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 16 }}>
              <div
                style={{
                  background: 'rgba(2,12,24,0.78)',
                  border: '1px solid rgba(52,211,153,0.08)',
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <SectionLabel>Domain mix</SectionLabel>
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {rawDomains.map((item) => {
                    const domain = String(item.name || 'unknown').toLowerCase()
                    const tone = (DOMAIN_STYLES[domain] || DOMAIN_STYLES.cyber).dot
                    const width = `${(Number(item.count || 0) / maxDomainCount) * 100}%`
                    return (
                      <div key={item.name}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: 11,
                            color: COLORS.secondary,
                          }}
                        >
                          <span>{String(item.name || 'unknown').toUpperCase()}</span>
                          <span style={{ color: COLORS.dim }}>{formatCount(item.count)}</span>
                        </div>
                        <div
                          style={{
                            marginTop: 6,
                            height: 8,
                            borderRadius: 999,
                            background: 'rgba(255,255,255,0.04)',
                            overflow: 'hidden',
                          }}
                        >
                          <div style={{ width, height: '100%', background: tone }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(2,12,24,0.78)',
                  border: '1px solid rgba(52,211,153,0.08)',
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <SectionLabel>Top sources</SectionLabel>
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {rawSources.map((item) => (
                    <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: COLORS.secondary }}>
                        {item.name}
                      </span>
                      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: COLORS.dim }}>
                        {formatCount(item.count)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="aurora-notifications">
        {activeNotifications.map(({ notificationId, alert }) => {
          const verdictTone = getVerdictTone(alert)
          return (
            <div
              key={notificationId}
              className="aurora-notification-card"
              style={{
                background: 'rgba(8,20,35,0.94)',
                border: `1px solid ${COLORS.border}`,
                borderLeft: `3px solid ${verdictTone}`,
                borderRadius: 12,
                padding: 14,
                boxShadow: '0 18px 45px rgba(0, 0, 0, 0.28)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 8px',
                        borderRadius: 999,
                        background: `${verdictTone}18`,
                        color: verdictTone,
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 10,
                        textTransform: 'uppercase',
                      }}
                    >
                      <StatusDot color={verdictTone} size={7} />
                      {alert.analystVerdict || 'New alert'}
                    </span>
                    <span
                      style={{
                        fontFamily: '"Cormorant Garamond", serif',
                        fontSize: 24,
                        fontWeight: 600,
                        color: getScoreTone(Number(alert.score || 0)),
                        lineHeight: 1,
                      }}
                    >
                      {Number(alert.score || 0)}%
                    </span>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 13, color: COLORS.text, lineHeight: 1.5 }}>
                    {alert.llmData?.headline || 'New correlated alert detected'}
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 10,
                      color: COLORS.muted,
                      textTransform: 'uppercase',
                    }}
                  >
                    {alert.analystEscalation || 'Escalation pending'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeNotification(notificationId)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: COLORS.dim,
                    fontSize: 16,
                    lineHeight: 1,
                    cursor: 'pointer',
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AlertDetail({ alert, onSpeak, voiceButtonState }) {
  const verdictTone = getVerdictTone(alert)
  const escalationTone = getEscalationTone(alert.analystEscalation)
  const scoreTone = getScoreTone(Number(alert.score || 0))
  const evidence = Array.isArray(alert.events) ? alert.events : []
  const voiceLabel =
    voiceButtonState === 'loading'
      ? '⏳ Generating...'
      : voiceButtonState === 'playing'
        ? '🔊 Speaking...'
        : '🔈 Speak alert'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div
          style={{
            flex: '1 1 420px',
            background: `${verdictTone}12`,
            border: `1px solid ${verdictTone}35`,
            borderRadius: 12,
            padding: 18,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  color: verdictTone,
                  fontFamily: '"Cormorant Garamond", serif',
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                <StatusDot color={verdictTone} size={10} />
                {alert.analystVerdict || 'Analyst verdict pending'}
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 15,
                  color: COLORS.text,
                  fontWeight: 500,
                  lineHeight: 1.5,
                }}
              >
                {alert.llmData?.headline || 'Correlation headline pending'}
              </div>
            </div>

            <div
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 12,
                color: scoreTone,
                textAlign: 'right',
                lineHeight: 1.7,
              }}
            >
              <div>{Number(alert.score || 0)}% signal confidence</div>
              <div>{alert.analystConfidence || 'Analyst confidence pending'}</div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 11px',
                borderRadius: 999,
                background: `${escalationTone}16`,
                border: `1px solid ${escalationTone}30`,
                color: escalationTone,
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 11,
                textTransform: 'uppercase',
              }}
            >
              {alert.analystEscalation || 'Escalation pending'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSpeak(alert)}
          disabled={voiceButtonState === 'loading'}
          style={{
            alignSelf: 'flex-start',
            background: 'transparent',
            border: '1px solid rgba(52,211,153,0.36)',
            color: COLORS.green,
            borderRadius: 10,
            padding: '12px 14px',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 12,
            cursor: voiceButtonState === 'loading' ? 'progress' : 'pointer',
            minWidth: 160,
          }}
        >
          {voiceLabel}
        </button>
      </div>

      <DetailSection label="Assessment">
        <div style={{ fontSize: 13, color: COLORS.secondary, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          {alert.analystNarrative || 'Awaiting analyst narrative.'}
        </div>
      </DetailSection>

      <DetailSection label="Why signals are connected">
        <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.7 }}>
          {alert.llmData?.summary || 'Correlation summary pending.'}
        </div>
      </DetailSection>

      <DetailSection label="Operational gaps">
        <div
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 12,
            color: COLORS.dim,
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
          }}
        >
          {alert.analystGaps || 'No documented gaps yet.'}
        </div>
      </DetailSection>

      <DetailSection label="Recommended actions">
        <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          {alert.analystActions || alert.llmData?.recommendation || 'Awaiting recommended actions.'}
        </div>
      </DetailSection>

      <DetailSection label={`Evidence (${evidence.length})`}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {evidence.length === 0 ? (
            <div style={{ fontStyle: 'italic', color: '#334155' }}>No linked evidence yet.</div>
          ) : (
            evidence.map((event, index) => {
              const domain = inferDomain(event)
              const domainStyle = DOMAIN_STYLES[domain]
              return (
                <div
                  key={event.id || `${event.title}-${index}`}
                  style={{
                    padding: '12px 0',
                    borderBottom: index === evidence.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: domainStyle.dot,
                        boxShadow: `0 0 12px ${domainStyle.dot}`,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: COLORS.secondary, lineHeight: 1.5 }}>
                        {event.title || 'Untitled evidence item'}
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontFamily: '"JetBrains Mono", monospace',
                          fontSize: 10,
                          color: COLORS.slate,
                          lineHeight: 1.6,
                        }}
                      >
                        {formatEventType(event.type)} · {event.severity || 'Unknown severity'} · {formatTimestamp(event.timestamp)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </DetailSection>
    </div>
  )
}

function MessageBody({ body }) {
  const lines = cleanDisplayText(body)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (!lines.length) {
    return null
  }

  const elements = []
  let bulletItems = []

  const flushBullets = () => {
    if (!bulletItems.length) {
      return
    }
    elements.push(
      <ol key={`list-${elements.length}`} style={{ margin: 0, paddingLeft: 18, color: COLORS.secondary, lineHeight: 1.7 }}>
        {bulletItems.map((item, index) => (
          <li key={`${item}-${index}`} style={{ marginBottom: 6 }}>
            {renderInlineMarkup(item)}
          </li>
        ))}
      </ol>,
    )
    bulletItems = []
  }

  lines.forEach((line) => {
    if (/^#{1,6}\s+/.test(line)) {
      flushBullets()
      elements.push(
        <div key={`h-${elements.length}`} style={{ marginBottom: 8, color: COLORS.text, fontWeight: 600 }}>
          {renderInlineMarkup(line.replace(/^#{1,6}\s+/, ''))}
        </div>,
      )
      return
    }

    if (/^\d+\.\s+/.test(line) || /^-\s+/.test(line)) {
      bulletItems.push(line.replace(/^\d+\.\s+/, '').replace(/^-\s+/, '').trim())
      return
    }

    flushBullets()
    elements.push(
      <p key={`p-${elements.length}`} style={{ margin: 0, color: COLORS.secondary, lineHeight: 1.7 }}>
        {renderInlineMarkup(line)}
      </p>,
    )
  })

  flushBullets()
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{elements}</div>
}

function renderInlineMarkup(text) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`${part}-${index}`} style={{ color: COLORS.text }}>
          {part.slice(2, -2)}
        </strong>
      )
    }
    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
  })
}

function StatCard({ accent, label, value, subLabel }) {
  return (
    <div
      className="aurora-fade-up"
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderTop: `2px solid ${accent}`,
        borderRadius: 12,
        padding: '16px 20px',
      }}
    >
      <div
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 10,
          letterSpacing: 2,
          color: COLORS.dim,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 12,
          fontFamily: '"Cormorant Garamond", serif',
          fontSize: 36,
          fontWeight: 600,
          color: accent,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: COLORS.slate }}>{subLabel}</div>
    </div>
  )
}

function MiniStatCard({ label, value, accent }) {
  return (
    <div
      style={{
        background: 'rgba(2,12,24,0.78)',
        border: '1px solid rgba(52,211,153,0.08)',
        borderTop: `2px solid ${accent}`,
        borderRadius: 12,
        padding: 12,
      }}
    >
      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: 1.4 }}>
        {label}
      </div>
      <div style={{ marginTop: 10, fontFamily: '"Cormorant Garamond", serif', fontSize: 28, fontWeight: 600, color: accent }}>
        {value}
      </div>
    </div>
  )
}

function Panel({ title, color, children, emptyText, height }) {
  const hasContent = React.Children.count(children) > 0

  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        padding: 16,
        minHeight: height || undefined,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 1.4,
          color,
        }}
      >
        <StatusDot color={color} size={8} />
        {title}
      </div>

      <div style={{ marginTop: 16 }}>
        {hasContent ? (
          children
        ) : (
          <div
            style={{
              minHeight: height ? height - 72 : 120,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              color: '#334155',
              fontStyle: 'italic',
            }}
          >
            {emptyText}
          </div>
        )}
      </div>
    </div>
  )
}

function DetailSection({ label, children }) {
  return (
    <div>
      <div
        style={{
          marginBottom: 8,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: COLORS.slate,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10,
        letterSpacing: 2,
        color: COLORS.dim,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  )
}

function EmptyPanel({ text }) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: '1px dashed rgba(148,163,184,0.18)',
        borderRadius: 12,
        minHeight: 140,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        fontStyle: 'italic',
        color: '#334155',
        padding: 20,
      }}
    >
      {text}
    </div>
  )
}

function StatusDot({ color, size }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        boxShadow: `0 0 14px ${color}`,
        display: 'inline-block',
        animation: 'pulse-dot 1.5s ease-in-out infinite',
        flexShrink: 0,
      }}
    />
  )
}

function StatusBadge({ label, active, tone }) {
  const color = active ? tone || COLORS.green : COLORS.dim
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderRadius: 999,
        border: `1px solid ${color}33`,
        background: `${color}14`,
        color,
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10,
        textTransform: 'uppercase',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

function DomainPill({ domain, label }) {
  const key = String(domain || 'cyber').toLowerCase()
  const style = DOMAIN_STYLES[key] || DOMAIN_STYLES.cyber
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '5px 8px',
        borderRadius: 999,
        background: style.pillBg,
        color: style.pillText,
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10,
        letterSpacing: 1,
        textTransform: 'uppercase',
      }}
    >
      {label || key}
    </span>
  )
}

function ToggleChip({ label, active, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: `1px solid ${active ? 'rgba(52,211,153,0.24)' : 'rgba(148,163,184,0.16)'}`,
        background: active ? 'rgba(52,211,153,0.12)' : 'rgba(2,12,24,0.78)',
        color: disabled ? COLORS.dim : active ? COLORS.green : COLORS.secondary,
        borderRadius: 999,
        padding: '8px 10px',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10,
        textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function ActionButton({ label, onClick, disabled, tone, compact }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        minWidth: compact ? 96 : undefined,
        padding: compact ? '9px 12px' : '11px 14px',
        borderRadius: 10,
        border: `1px solid ${tone}45`,
        background: disabled ? 'rgba(15,23,42,0.65)' : `${tone}14`,
        color: disabled ? COLORS.dim : tone,
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: compact ? 11 : 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function InlineNotice({ tone, text }) {
  return (
    <div
      style={{
        borderRadius: 10,
        border: `1px solid ${tone}33`,
        background: `${tone}12`,
        color: tone,
        padding: '9px 11px',
        fontSize: 11,
        lineHeight: 1.6,
      }}
    >
      {text}
    </div>
  )
}

function MiniMetric({ label, value, small }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        alignItems: small ? 'flex-start' : 'center',
        paddingBottom: 10,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: COLORS.dim, textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ color: small ? COLORS.muted : COLORS.secondary, fontSize: small ? 11 : 13, textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}

function ServiceRow({ label, active, detail, tone }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
      <div>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, textTransform: 'uppercase', color: COLORS.dim }}>
          {label}
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: COLORS.slate, lineHeight: 1.5 }}>
          {detail || 'Unavailable'}
        </div>
      </div>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 9px',
          borderRadius: 999,
          border: `1px solid ${(active ? tone : COLORS.dim)}33`,
          background: `${active ? tone : COLORS.dim}14`,
          color: active ? tone : COLORS.dim,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 10,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 999, background: active ? tone : COLORS.dim, display: 'inline-block' }} />
        {active ? 'Ready' : 'Offline'}
      </span>
    </div>
  )
}

function FilterSelect({ value, onChange, children }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={{
        borderRadius: 999,
        border: '1px solid rgba(52,211,153,0.14)',
        background: 'rgba(2,12,24,0.9)',
        color: COLORS.secondary,
        padding: '10px 14px',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 11,
        outline: 'none',
      }}
    >
      {children}
    </select>
  )
}

function TinyFlag({ text, tone }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 7px',
        borderRadius: 999,
        border: `1px solid ${tone}33`,
        background: `${tone}12`,
        color: tone,
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10,
      }}
    >
      {text}
    </span>
  )
}

const tableCellStyle = {
  padding: '12px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  fontSize: 12,
  color: COLORS.muted,
  verticalAlign: 'top',
}

function buildResolvedAlerts(rawAlerts, liveEvents, analystMap) {
  const eventsById = new Map(liveEvents.map((event) => [String(event.id), event]))

  return sortAlerts(
    rawAlerts.map((rawAlert) => {
      const alertId = String(rawAlert?.id ?? '')
      const resolvedEvents = Array.isArray(rawAlert?.events)
        ? rawAlert.events.map((event) => resolveEvent(event, eventsById)).filter(Boolean)
        : []

      const llmData = {
        headline: '',
        summary: '',
        recommendation: '',
        ...(rawAlert?.llmData || {}),
      }

      return mergeAlertAnalyst(
        {
          ...rawAlert,
          id: alertId,
          llmData,
          events: resolvedEvents,
        },
        analystMap[alertId],
      )
    }),
  )
}

function buildStreamCandidates(liveEvents, alerts) {
  if (Array.isArray(liveEvents) && liveEvents.length > 0) {
    return liveEvents
  }

  const deduped = new Map()
  ;(alerts || []).forEach((alert) => {
    ;(alert.events || []).forEach((event) => {
      const eventId = String(event?.id ?? '')
      if (!eventId || deduped.has(eventId)) {
        return
      }
      deduped.set(eventId, event)
    })
  })

  return sortEvents(Array.from(deduped.values()))
}

function resolveEvent(event, eventsById) {
  if (!event) {
    return null
  }

  if (typeof event === 'string' || typeof event === 'number') {
    return (
      eventsById.get(String(event)) || {
        id: String(event),
        title: `Event ${event}`,
        type: 'unknown',
        severity: 'unknown',
        timestamp: '',
        region: '',
        detail: '',
      }
    )
  }

  return event
}

function buildAnalystMap(payload) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.verdicts) ? payload.verdicts : []

  return rows.reduce((accumulator, row) => {
    const alertId = row?.alert_id || row?.alertId || row?.id
    if (!alertId) {
      return accumulator
    }

    accumulator[String(alertId)] = {
      analystVerdict: row.analystVerdict ?? row.analyst_verdict,
      analystConfidence: row.analystConfidence ?? row.analyst_confidence,
      analystEscalation: row.analystEscalation ?? row.analyst_escalation,
      analystNarrative: row.analystNarrative ?? row.analyst_narrative,
      analystGaps: row.analystGaps ?? row.analyst_gaps,
      analystActions: row.analystActions ?? row.analyst_actions,
      analystRanAt: row.analystRanAt ?? row.analyst_ran_at,
    }
    return accumulator
  }, {})
}

function mergeAlertAnalyst(alert, overlay) {
  if (!overlay) {
    return alert
  }

  const nextAlert = { ...alert }
  ANALYST_FIELDS.forEach((field) => {
    if (overlay[field] !== undefined && overlay[field] !== null && overlay[field] !== '') {
      nextAlert[field] = overlay[field]
    }
  })
  return nextAlert
}

function sortAlerts(items) {
  return [...items].sort((left, right) => Number(right?.score || 0) - Number(left?.score || 0))
}

function sortEvents(items) {
  return [...items].sort((left, right) => parseTimestamp(right?.timestamp) - parseTimestamp(left?.timestamp))
}

function pickSelectedAlertId(currentId, nextAlerts) {
  if (!nextAlerts.length) {
    return null
  }
  if (!currentId) {
    return nextAlerts[0].id
  }
  return nextAlerts.some((alert) => alert.id === currentId) ? currentId : nextAlerts[0].id
}

function buildAnalystBoardContext(selectedAlert, alerts, liveEvents, summary) {
  return {
    dashboardStats: summary || {},
    correlatedAlerts: (alerts || []).slice(0, 18).map((alert) => ({
      id: alert.id,
      region: alert.region,
      score: alert.score,
      headline: alert.llmData?.headline || null,
      signalCount: Array.isArray(alert.events) ? alert.events.length : 0,
      topSignals: (alert.events || []).slice(0, 6).map((event) => ({
        type: event.type,
        title: event.title,
        severity: event.severity,
      })),
    })),
    recentLiveFeed: (liveEvents || []).slice(0, 45).map((event) => ({
      id: event.id,
      type: event.type,
      region: event.region,
      title: event.title,
      severity: event.severity,
      at: typeof event.timestamp === 'number' ? new Date(event.timestamp).toISOString() : String(event.timestamp || ''),
    })),
    selectedAlertDetail: selectedAlert
      ? {
          selectedAlertId: selectedAlert.id,
          region: selectedAlert.region,
          score: selectedAlert.score,
          headline: selectedAlert.llmData?.headline || null,
          summary: selectedAlert.llmData?.summary || null,
          recommendation: selectedAlert.llmData?.recommendation || null,
          analystVerdict: selectedAlert.analystVerdict || null,
          signals: (selectedAlert.events || []).slice(0, 16).map((event) => ({
            type: event.type,
            title: event.title,
            detail: event.detail,
            severity: event.severity,
            region: event.region,
          })),
        }
      : null,
  }
}

function buildVoiceContext(selectedAlert, alerts, liveEvents) {
  return {
    selectedRegion: selectedAlert?.region || null,
    selectedHeadline: selectedAlert?.llmData?.headline || null,
    alertHints: (alerts || [])
      .slice(0, 8)
      .flatMap((alert) => [
        alert.region,
        alert.llmData?.headline,
        ...(alert.events || []).slice(0, 3).map((event) => event.title),
      ])
      .filter(Boolean),
    feedHints: (liveEvents || []).slice(0, 12).map((event) => event.title).filter(Boolean),
  }
}

function toApiMessages(uiMessages, newUserText) {
  const output = []
  let seenUser = false

  for (const message of uiMessages) {
    if (message.role === 'assistant' && !seenUser) {
      continue
    }
    if (message.role === 'user') {
      seenUser = true
      output.push({ role: 'user', content: message.body })
    } else if (message.role === 'assistant') {
      output.push({ role: 'assistant', content: message.body })
    }
  }

  output.push({ role: 'user', content: newUserText })
  return output
}

function cleanDisplayText(text) {
  return String(text || '')
    .replace(/^\[(background noise|music|silence|inaudible)\]\s*/i, '')
    .replace(/\r\n/g, '\n')
    .trim()
}

function nowTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

function uid() {
  return globalThis.crypto?.randomUUID?.() || `m-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function pickSupportedMimeType() {
  if (!globalThis.MediaRecorder?.isTypeSupported) {
    return ''
  }

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]

  return candidates.find((type) => globalThis.MediaRecorder.isTypeSupported(type)) || ''
}

async function fetchJson(path) {
  const response = await fetch(apiUrl(path))
  if (!response.ok) {
    throw new Error(await extractErrorDetail(response, `${path} failed (${response.status})`))
  }
  return response.json()
}

async function extractErrorDetail(response, fallback) {
  try {
    const payload = await response.json()
    if (payload?.detail) {
      return typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail)
    }
  } catch {
    return fallback
  }
  return fallback
}

function parseTimestamp(value) {
  const time = new Date(value || 0).getTime()
  return Number.isNaN(time) ? 0 : time
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatTimestamp(value) {
  if (!value) {
    return 'Timestamp pending'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return date.toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatCount(value) {
  return Number(value || 0).toLocaleString()
}

function formatEventType(value) {
  if (!value) {
    return 'Unknown'
  }
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function inferDomain(event) {
  const haystack = `${event?.domain || ''} ${event?.type || ''} ${event?.title || ''} ${event?.detail || ''}`.toLowerCase()

  if (
    haystack.includes('physical') ||
    haystack.includes('camera') ||
    haystack.includes('drone') ||
    haystack.includes('sensor') ||
    haystack.includes('access') ||
    haystack.includes('badge') ||
    haystack.includes('vehicle')
  ) {
    return 'physical'
  }

  if (
    haystack.includes('osint') ||
    haystack.includes('news') ||
    haystack.includes('social') ||
    haystack.includes('media') ||
    haystack.includes('gdelt') ||
    haystack.includes('report')
  ) {
    return 'osint'
  }

  return 'cyber'
}

function getAlertDomains(alert) {
  const domains = Array.from(new Set((alert.events || []).map((event) => inferDomain(event))))
  return domains.length ? domains : ['cyber']
}

function shouldRevealAlert(alert, streamedEventIds) {
  const evidence = Array.isArray(alert?.events) ? alert.events : []
  if (!evidence.length) {
    return true
  }

  const matched = evidence.filter((event) => streamedEventIds.has(String(event?.id ?? ''))).length
  const required = Math.min(2, evidence.length)
  return matched >= required
}

function getScoreTone(score) {
  if (score >= 80) {
    return COLORS.red
  }
  if (score >= 60) {
    return COLORS.amber
  }
  return COLORS.blue
}

function getSeverityTone(severity) {
  const value = String(severity || '').toUpperCase()
  if (value.includes('CRIT')) {
    return COLORS.red
  }
  if (value.includes('HIGH')) {
    return COLORS.amber
  }
  if (value.includes('LOW')) {
    return COLORS.blue
  }
  return COLORS.green
}

function getVerdictTone(alert) {
  const value = `${alert?.analystVerdict || ''} ${alert?.analystEscalation || ''}`.toLowerCase()

  if (
    value.includes('critical') ||
    value.includes('confirmed') ||
    value.includes('active') ||
    value.includes('compromise') ||
    value.includes('malicious') ||
    value.includes('immediate')
  ) {
    return COLORS.red
  }

  if (
    value.includes('monitor') ||
    value.includes('review') ||
    value.includes('suspicious') ||
    value.includes('elevated') ||
    value.includes('moderate')
  ) {
    return COLORS.amber
  }

  if (value.includes('benign') || value.includes('informational') || value.includes('resolved')) {
    return COLORS.green
  }

  return COLORS.purple
}

function getEscalationTone(value) {
  const text = String(value || '').toLowerCase()

  if (text.includes('immediate') || text.includes('sev') || text.includes('critical') || text.includes('contain')) {
    return COLORS.red
  }
  if (text.includes('monitor') || text.includes('review') || text.includes('elevated')) {
    return COLORS.amber
  }
  if (text.includes('observe') || text.includes('track')) {
    return COLORS.blue
  }
  return COLORS.green
}

function buildVoiceScript(alert) {
  const parts = [
    alert.analystVerdict ? `Verdict: ${alert.analystVerdict}.` : 'Analyst verdict pending.',
    alert.llmData?.headline ? `Headline: ${alert.llmData.headline}.` : '',
    `Confidence score ${Number(alert.score || 0)} percent.`,
    alert.analystEscalation ? `Escalation recommendation: ${alert.analystEscalation}.` : '',
  ]
  return parts.filter(Boolean).join(' ')
}

export default App
