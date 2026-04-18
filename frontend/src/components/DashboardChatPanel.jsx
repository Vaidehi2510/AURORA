import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  auroraApiConfigured,
  fetchAnalystChatStatus,
  postAnalystChat,
} from '../api/auroraClient.js'
import styles from './DashboardChatPanel.module.css'

function nowTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

/**
 * Snapshot of what the analyst sees on the dashboard (sent each turn so the model
 * stays aligned with the live feed and correlated incidents, not only the selected card).
 */
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

const OFFLINE_THREAD = [
  {
    id: 'p1',
    role: 'system',
    time: '—',
    body: 'OpenRouter is not configured on the API (missing OPENROUTER_API_KEY), or the API is unreachable.',
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
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const threadRef = useRef(null)

  const scrollToBottom = () => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (!auroraApiConfigured()) {
      setStatusLoaded(true)
      setConfigured(false)
      return undefined
    }
    let cancelled = false
    ;(async () => {
      try {
        const s = await fetchAnalystChatStatus()
        if (cancelled) return
        setConfigured(Boolean(s.configured))
        setModelLabel(s.model || '')
        if (s.configured) {
          setMessages([
            {
              id: uid(),
              role: 'assistant',
              time: nowTime(),
              body:
                'OpenRouter is connected. Ask about the selected alert, contributing signals, or next verification steps. Each reply uses the alert you have selected when you press Send.',
            },
          ])
        } else {
          setMessages([])
        }
      } catch {
        if (!cancelled) {
          setConfigured(false)
          setMessages([])
        }
      } finally {
        if (!cancelled) setStatusLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || sending || !configured) return

    const userMsg = { id: uid(), role: 'you', time: nowTime(), body: text }
    const apiHistory = toApiMessages(messages, text)

    setDraft('')
    setError(null)
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setSending(false)
    }
  }, [alerts, configured, draft, messages, sending, selectedAlert, stats, ticker])

  const clearThread = useCallback(() => {
    setError(null)
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
  }, [configured])

  const onKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const ready = auroraApiConfigured() && statusLoaded && configured
  const showOfflinePreview = !auroraApiConfigured() || (statusLoaded && !configured)
  const serverMissingOpenRouter =
    auroraApiConfigured() && statusLoaded && !configured

  const displayMessages = showOfflinePreview ? OFFLINE_THREAD : messages

  return (
    <div className={panelClass}>
      <div className={styles.header}>
        <span className={styles.dot} />
        <span className={styles.title}>ANALYST CHAT</span>
        {!auroraApiConfigured() ? (
          <span className={styles.badge}>No API</span>
        ) : !statusLoaded ? (
          <span className={styles.badge}>…</span>
        ) : configured ? (
          <span className={styles.badgeLive}>OpenRouter</span>
        ) : (
          <span className={styles.badge}>Offline</span>
        )}
        {ready && modelLabel && (
          <span className={styles.modelPill} title="Model on server">
            {modelLabel}
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
          <span className={styles.contextMeta}>No alert selected — model still receives feed + all incidents each send</span>
        )}
        <span className={styles.contextMeta}>
          {' '}
          · {alerts?.length ?? 0} incidents · {ticker?.length ?? 0} feed items
        </span>
      </div>

      {error && ready && <div className={styles.errorBanner}>{error}</div>}

      <div
        ref={threadRef}
        className={styles.thread}
        aria-label={ready ? 'Analyst chat' : 'Chat preview'}
      >
        {!statusLoaded && auroraApiConfigured() && (
          <div className={styles.msg}>
            <div className={styles.msgMeta}>
              <span className={styles.role_system}>system</span>
              <span className={styles.msgTime}>—</span>
            </div>
            <div className={styles.msgBody}>Checking analyst chat status…</div>
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
            <div className={styles.msgBody}>{msg.body}</div>
          </div>
        ))}
      </div>

      <div className={styles.composer}>
        <textarea
          className={styles.input}
          rows={2}
          placeholder={
            ready
              ? 'Ask the model about this incident, evidence gaps, or next steps…'
              : serverMissingOpenRouter
                ? 'API is reachable but OPENROUTER_API_KEY is missing on the server — set repo-root .env and restart uvicorn.'
                : showOfflinePreview
                  ? 'Connect the frontend to the API (npm run dev + uvicorn) to chat.'
                  : '…'
          }
          disabled={!ready || sending}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className={styles.send}
          disabled={!ready || sending || !draft.trim()}
          onClick={send}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
