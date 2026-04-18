import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  auroraApiConfigured,
  fetchAnalystChatStatus,
  fetchVoiceStatus,
  postAnalystChat,
  postVoiceSpeech,
  postVoiceTranscription,
} from '../api/auroraClient.js'
import styles from './DashboardChatPanel.module.css'

function nowTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function pickSupportedMimeType() {
  if (!globalThis.MediaRecorder?.isTypeSupported) return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  return candidates.find(type => globalThis.MediaRecorder.isTypeSupported(type)) ?? ''
}

/** Build OpenAI-style history: no leading assistant before the first user turn. */
function toApiMessages(uiMessages, newUserText) {
  const out = []
  let seenUser = false
  for (const m of uiMessages) {
    if (m.role === 'assistant' && !seenUser) continue
    if (m.role === 'you') seenUser = true
    if (m.role === 'you') out.push({ role: 'user', content: m.body })
    else if (m.role === 'assistant') out.push({ role: 'assistant', content: m.body })
  }
  out.push({ role: 'user', content: newUserText })
  return out
}

function buildAnalystBoardContext(selectedAlert, alerts, ticker, stats) {
  const correlatedAlerts = (alerts ?? []).slice(0, 18).map(a => ({
    id: a.id,
    region: a.region,
    score: a.score,
    headline: a.llmData?.headline ?? null,
    signalCount: a.events?.length ?? 0,
    topSignals: (a.events ?? []).slice(0, 6).map(e => ({
      type: e.type,
      title: e.title,
      severity: e.severity,
    })),
  }))

  const recentLiveFeed = (ticker ?? []).slice(0, 45).map(e => ({
    id: e.id,
    type: e.type,
    region: e.region,
    title: e.title,
    severity: e.severity,
    at:
      typeof e.timestamp === 'number'
        ? new Date(e.timestamp).toISOString()
        : String(e.timestamp ?? ''),
  }))

  const selectedAlertDetail = selectedAlert
    ? {
        selectedAlertId: selectedAlert.id,
        region: selectedAlert.region,
        score: selectedAlert.score,
        headline: selectedAlert.llmData?.headline ?? null,
        summary: selectedAlert.llmData?.summary ?? null,
        recommendation: selectedAlert.llmData?.recommendation ?? null,
        analystNote: selectedAlert.note ?? '',
        signals: (selectedAlert.events ?? []).slice(0, 16).map(e => ({
          type: e.type,
          title: e.title,
          detail: e.detail,
          severity: e.severity,
          region: e.region,
        })),
      }
    : null

  return {
    dashboardStats: stats ?? null,
    correlatedAlerts,
    recentLiveFeed,
    selectedAlertDetail,
  }
}

function buildVoiceContext(selectedAlert, alerts, ticker) {
  return {
    selectedRegion: selectedAlert?.region ?? null,
    selectedHeadline: selectedAlert?.llmData?.headline ?? null,
    alertHints: (alerts ?? []).slice(0, 8).flatMap(alert => [
      alert.region,
      alert.llmData?.headline,
      ...(alert.events ?? []).slice(0, 3).map(ev => ev.title),
    ]).filter(Boolean),
    feedHints: (ticker ?? []).slice(0, 12).map(item => item.title).filter(Boolean),
  }
}

function buildAlertBrief(selectedAlert) {
  if (!selectedAlert) return ''
  const parts = [
    selectedAlert.llmData?.headline,
    selectedAlert.llmData?.summary,
    selectedAlert.llmData?.recommendation ? `Recommended next step: ${selectedAlert.llmData.recommendation}` : '',
    selectedAlert.llmData?.uncertainty ? `Uncertainty: ${selectedAlert.llmData.uncertainty}` : '',
  ].filter(Boolean)
  return parts.join(' ')
}

function cleanDisplayText(text) {
  return String(text ?? '')
    .replace(/^\[(background noise|music|silence|inaudible)\]\s*/i, '')
    .replace(/\r\n/g, '\n')
    .trim()
}

function renderInlineMarkup(line) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    return <React.Fragment key={index}>{part}</React.Fragment>
  })
}

function renderMessageBody(text) {
  const cleaned = cleanDisplayText(text)
  if (!cleaned) return null

  const lines = cleaned
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const elements = []
  let bulletItems = []

  const flushBullets = () => {
    if (!bulletItems.length) return
    elements.push(
      <ol key={`list-${elements.length}`} className={styles.msgList}>
        {bulletItems.map((item, index) => (
          <li key={index}>{renderInlineMarkup(item)}</li>
        ))}
      </ol>
    )
    bulletItems = []
  }

  const normalizedLines = lines.flatMap(line => {
    const matches = line.match(/\d+\.\s+\*\*[^*]+\*\*:?|(?:^|\s)\d+\.\s+/g)
    if (!matches || matches.length <= 1) return [line]
    return line.split(/(?=\s*\d+\.\s+)/g).map(part => part.trim()).filter(Boolean)
  })

  normalizedLines.forEach(line => {
    if (/^#{1,6}\s+/.test(line)) {
      flushBullets()
      elements.push(
        <div key={`h-${elements.length}`} className={styles.msgHeading}>
          {renderInlineMarkup(line.replace(/^#{1,6}\s+/, '').trim())}
        </div>
      )
      return
    }
    if (/^-\s+/.test(line)) {
      bulletItems.push(line.replace(/^-\s+/, '').trim())
      return
    }
    if (/^\d+\.\s+/.test(line)) {
      bulletItems.push(line.replace(/^\d+\.\s+/, '').trim())
      return
    }
    flushBullets()
    elements.push(
      <p key={`p-${elements.length}`} className={styles.msgParagraph}>
        {renderInlineMarkup(line)}
      </p>
    )
  })

  flushBullets()
  return elements
}

const OFFLINE_THREAD = [
  {
    id: 'p1',
    role: 'system',
    time: '---',
    body: 'OpenRouter is not configured on the API (missing OPENROUTER_API_KEY), or the API is unreachable.',
  },
  {
    id: 'p2',
    role: 'you',
    time: '---',
    body: 'Analyst note: hold correlation review until comms go live.',
  },
  {
    id: 'p3',
    role: 'peer',
    time: '---',
    body: 'Copy. Standing by on fusion desk.',
  },
]

export default function DashboardChatPanel({
  variant = 'compact',
  selectedAlert = null,
  alerts = [],
  ticker = [],
  stats = null,
}) {
  const panelClass =
    variant === 'main' ? `${styles.panel} ${styles.panelMain}` : styles.panel

  const [configured, setConfigured] = useState(false)
  const [modelLabel, setModelLabel] = useState('')
  const [voiceTtsReady, setVoiceTtsReady] = useState(false)
  const [voiceSttReady, setVoiceSttReady] = useState(false)
  const [voiceModelLabel, setVoiceModelLabel] = useState('')
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [autoSpeak, setAutoSpeak] = useState(true)
  const [autoSendVoice, setAutoSendVoice] = useState(true)
  const [error, setError] = useState(null)
  const [voiceError, setVoiceError] = useState(null)
  const [transcriptMeta, setTranscriptMeta] = useState(null)

  const threadRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const chunksRef = useRef([])
  const audioRef = useRef(null)
  const audioUrlRef = useRef(null)

  const ready = auroraApiConfigured() && statusLoaded && configured
  const showOfflinePreview = !auroraApiConfigured() || (statusLoaded && !configured)
  const serverMissingOpenRouter = auroraApiConfigured() && statusLoaded && !configured
  const voiceReady = auroraApiConfigured() && statusLoaded && (voiceTtsReady || voiceSttReady)
  const displayMessages = showOfflinePreview ? OFFLINE_THREAD : messages

  const latestAssistantText = [...messages].reverse().find(msg => msg.role === 'assistant')?.body ?? ''

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onended = null
      audioRef.current = null
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
    setSpeaking(false)
  }, [])

  const stopMediaStream = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (!auroraApiConfigured()) {
      setStatusLoaded(true)
      setConfigured(false)
      return undefined
    }
    let cancelled = false
    ;(async () => {
      const [chatResult, voiceResult] = await Promise.allSettled([
        fetchAnalystChatStatus(),
        fetchVoiceStatus(),
      ])

      if (cancelled) return

      if (chatResult.status === 'fulfilled') {
        const s = chatResult.value
        setConfigured(Boolean(s.configured))
        setModelLabel(s.model || '')
        if (s.configured) {
          setMessages([
            {
              id: uid(),
              role: 'assistant',
              time: nowTime(),
              body:
                'OpenRouter is connected. Ask about the selected alert, contributing signals, or next verification steps. You can also use the mic to transcribe a question and play back the response.',
            },
          ])
        } else {
          setMessages([])
        }
      } else {
        setConfigured(false)
        setMessages([])
      }

      if (voiceResult.status === 'fulfilled') {
        const v = voiceResult.value
        setVoiceTtsReady(Boolean(v.tts))
        setVoiceSttReady(Boolean(v.stt))
        setVoiceModelLabel([v.sttModel, v.ttsModel].filter(Boolean).join(' / '))
      } else {
        setVoiceTtsReady(false)
        setVoiceSttReady(false)
      }

      setStatusLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => () => {
    stopPlayback()
    stopMediaStream()
  }, [stopMediaStream, stopPlayback])

  const playText = useCallback(async text => {
    const trimmed = text.trim()
    if (!trimmed || !voiceReady || !voiceTtsReady) return
    stopPlayback()
    setVoiceError(null)
    setSpeaking(true)
    try {
      const blob = await postVoiceSpeech({ text: trimmed })
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => stopPlayback()
      audio.onerror = () => {
        stopPlayback()
        setVoiceError('Playback failed in the browser.')
      }
      await audio.play()
    } catch (e) {
      stopPlayback()
      setVoiceError(e instanceof Error ? e.message : 'Voice synthesis failed')
    }
  }, [stopPlayback, voiceReady, voiceTtsReady])

  const send = useCallback(async (overrideText = null) => {
    const text = cleanDisplayText(overrideText ?? draft)
    if (!text || sending || !configured) return

    const userMsg = { id: uid(), role: 'you', time: nowTime(), body: text }
    const apiHistory = toApiMessages(messages, text)

    setDraft('')
    setError(null)
    setVoiceError(null)
    setMessages(prev => [...prev, userMsg])
    setSending(true)

    try {
      const { reply } = await postAnalystChat({
        messages: apiHistory,
        context: buildAnalystBoardContext(selectedAlert, alerts, ticker, stats),
      })
      setMessages(prev => [
        ...prev,
        { id: uid(), role: 'assistant', time: nowTime(), body: reply },
      ])
      if (autoSpeak && voiceReady && voiceTtsReady) {
        void playText(reply)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setSending(false)
    }
  }, [
    alerts,
    autoSpeak,
    configured,
    draft,
    messages,
    playText,
    selectedAlert,
    sending,
    stats,
    ticker,
    voiceReady,
    voiceTtsReady,
  ])

  const clearThread = useCallback(() => {
    setError(null)
    setVoiceError(null)
    setTranscriptMeta(null)
    stopPlayback()
    if (configured) {
      setMessages([
        {
          id: uid(),
          role: 'assistant',
          time: nowTime(),
          body: 'Conversation cleared. What should we look at next?',
        },
      ])
    } else {
      setMessages([])
    }
  }, [configured, stopPlayback])

  const transcribeBlob = useCallback(async blob => {
    if (!voiceReady || !voiceSttReady) return
    setVoiceError(null)
    setTranscriptMeta(null)
    setTranscribing(true)
    try {
      const formData = new FormData()
      formData.append('file', blob, 'aurora-voice.webm')
      formData.append('context_json', JSON.stringify(buildVoiceContext(selectedAlert, alerts, ticker)))
      const result = await postVoiceTranscription(formData)
      setTranscriptMeta(result)
      const incoming = cleanDisplayText(result.text || '')
      if (!incoming) return
      if (autoSendVoice && configured && !sending) {
        setDraft(incoming)
        void send(incoming)
      } else {
        setDraft(prev => (prev.trim() ? `${prev.trim()} ${incoming}` : incoming))
      }
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : 'Voice transcription failed')
    } finally {
      setTranscribing(false)
    }
  }, [alerts, autoSendVoice, configured, selectedAlert, send, sending, ticker, voiceReady, voiceSttReady])

  const startRecording = useCallback(async () => {
    if (!voiceReady || !voiceSttReady || recording || transcribing) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Microphone capture is not supported in this browser.')
      return
    }

    stopPlayback()
    setVoiceError(null)
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
      recorder.ondataavailable = event => {
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
        stopMediaStream()
        chunksRef.current = []
        if (blob.size > 0) {
          void transcribeBlob(blob)
        } else {
          setVoiceError('No audio was captured. Try speaking a little longer.')
        }
      }
      recorder.start(250)
      setRecording(true)
    } catch (e) {
      stopMediaStream()
      setRecording(false)
      setVoiceError(e instanceof Error ? e.message : 'Microphone permission failed')
    }
  }, [recording, stopMediaStream, stopPlayback, transcribeBlob, transcribing, voiceReady, voiceSttReady])

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }, [])

  const onKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const showTranscriptMeta = Boolean(transcriptMeta?.uncertainTerms?.length || voiceError)
  const transcriptHint = transcriptMeta?.cleanupApplied
    ? `Transcript cleaned${transcriptMeta.usedLlmRepair ? ' with contextual repair' : ''}.`
    : 'Transcript captured.'

  return (
    <div className={panelClass}>
      <div className={styles.header}>
        <span className={styles.dot} />
        <span className={styles.title}>ANALYST CHAT</span>
        {!auroraApiConfigured() ? (
          <span className={styles.badge}>No API</span>
        ) : !statusLoaded ? (
          <span className={styles.badge}>...</span>
        ) : configured ? (
          <span className={styles.badgeLive}>OpenRouter</span>
        ) : (
          <span className={styles.badge}>Offline</span>
        )}
        {voiceReady ? (
          <span className={styles.badgeVoice}>Voice</span>
        ) : (
          <span className={styles.badge}>No Voice</span>
        )}
        {ready && modelLabel && (
          <span className={styles.modelPill} title="Model on server">
            {modelLabel}
          </span>
        )}
        {voiceReady && voiceModelLabel && (
          <span className={styles.modelPill} title="Voice models on server">
            {voiceModelLabel}
          </span>
        )}
        {ready && (
          <button type="button" className={styles.clearBtn} onClick={clearThread}>
            Clear
          </button>
        )}
      </div>

      <div className={styles.contextBar}>
        {selectedAlert ? (
          <>
            Focus: <strong>{selectedAlert.region}</strong>
            <span className={styles.contextMeta}> · {selectedAlert.score}%</span>
          </>
        ) : (
          <span className={styles.contextMeta}>No alert selected - model still receives feed + all incidents each send</span>
        )}
        <span className={styles.contextMeta}>
          {' '}
          · {alerts?.length ?? 0} incidents · {ticker?.length ?? 0} feed items
        </span>
      </div>

      {(error && ready) && <div className={styles.errorBanner}>{error}</div>}
      {(voiceError && auroraApiConfigured()) && <div className={styles.errorBanner}>{voiceError}</div>}

      <div
        ref={threadRef}
        className={styles.thread}
        aria-label={ready ? 'Analyst chat' : 'Chat preview'}
      >
        {!statusLoaded && auroraApiConfigured() && (
          <div className={styles.msg}>
            <div className={styles.msgMeta}>
              <span className={styles.role_system}>system</span>
              <span className={styles.msgTime}>---</span>
            </div>
            <div className={styles.msgBody}>Checking analyst chat and voice status...</div>
          </div>
        )}
        {displayMessages.map(msg => (
          <div key={msg.id} className={styles.msg}>
            <div className={styles.msgMeta}>
              <span
                className={
                  msg.role === 'you'
                    ? styles.role_you
                    : msg.role === 'assistant'
                      ? styles.role_assistant
                      : msg.role === 'peer'
                        ? styles.role_peer
                        : styles.role_system
                }
              >
                {msg.role === 'you' ? 'you' : msg.role === 'assistant' ? 'assistant' : msg.role}
              </span>
              <span className={styles.msgTime}>{msg.time}</span>
            </div>
            <div className={styles.msgBody}>{renderMessageBody(msg.body)}</div>
          </div>
        ))}
      </div>

      <div className={styles.composer}>
        <div className={styles.inputStack}>
          <textarea
            className={styles.input}
            rows={2}
            placeholder={
              ready
                ? 'Ask the model about this incident, evidence gaps, or next steps...'
                : serverMissingOpenRouter
                  ? 'API is reachable but OPENROUTER_API_KEY is missing on the server - set repo-root .env and restart uvicorn.'
                  : showOfflinePreview
                    ? 'Connect the frontend to the API (npm run dev + uvicorn) to chat.'
                    : '...'
            }
            disabled={!ready || sending}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className={styles.voiceRow}>
            <button
              type="button"
              className={recording ? styles.voiceBtnActive : styles.voiceBtn}
              disabled={!voiceReady || !voiceSttReady || transcribing}
              onClick={recording ? stopRecording : startRecording}
            >
              {recording ? 'Stop mic' : 'Mic'}
            </button>
            <button
              type="button"
              className={styles.voiceBtn}
              disabled={!voiceReady || !voiceTtsReady || speaking || !latestAssistantText}
              onClick={() => playText(latestAssistantText)}
            >
              {speaking ? 'Playing...' : 'Play reply'}
            </button>
            <button
              type="button"
              className={styles.voiceBtn}
              disabled={!voiceReady || !voiceTtsReady || speaking || !selectedAlert}
              onClick={() => playText(buildAlertBrief(selectedAlert))}
            >
              Brief alert
            </button>
            <label className={styles.autoSpeakToggle}>
              <input
                type="checkbox"
                checked={autoSpeak}
                disabled={!voiceReady || !voiceTtsReady}
                onChange={e => setAutoSpeak(e.target.checked)}
              />
              Auto-play replies
            </label>
            <label className={styles.autoSpeakToggle}>
              <input
                type="checkbox"
                checked={autoSendVoice}
                disabled={!voiceReady || !voiceSttReady || transcribing || sending}
                onChange={e => setAutoSendVoice(e.target.checked)}
              />
              Auto-send voice
            </label>
            {(recording || transcribing) && (
              <span className={styles.voiceStatus}>
                {recording ? 'Recording...' : 'Transcribing...'}
              </span>
            )}
          </div>
          {showTranscriptMeta && transcriptMeta?.text && (
            <div className={styles.transcriptMeta}>
              <span>{transcriptHint}</span>
              {transcriptMeta.uncertainTerms?.length > 0 && (
                <span className={styles.contextMeta}>
                  Check: {transcriptMeta.uncertainTerms.join(', ')}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className={styles.send}
          disabled={!ready || sending || !draft.trim()}
          onClick={send}
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
