/**
 * Base URL for the FastAPI app. Routes are always `/api/...` on the server.
 *
 * - Leave unset or empty: same-origin `/api/...` (Vite dev proxy → uvicorn).
 * - Full origin, e.g. `http://127.0.0.1:8000`: requests go there (no proxy).
 * - Do not set to `/api` only — that used to double the path; we normalize it.
 */
function resolveApiOrigin() {
  let v = (import.meta.env.VITE_AURORA_API ?? '').trim().replace(/\/$/, '')
  if (v === '/api') return ''
  return v
}

/**
 * Whether to show backend-connected UI (live data, analyst chat) and call `/api/*`.
 * Default is on so `vite preview` / production builds still talk to same-origin API.
 * Set `VITE_AURORA_API=false` or `0` to hide when no API exists.
 */
export function auroraApiConfigured() {
  const raw = (import.meta.env.VITE_AURORA_API ?? '').trim()
  if (raw === '0' || raw.toLowerCase() === 'false') return false
  return true
}

export function getAuroraApiBase() {
  return resolveApiOrigin() || '(same-origin /api)'
}

function apiUrl(path) {
  if (!path.startsWith('/')) throw new Error(`apiUrl expects absolute path, got ${path}`)
  const o = resolveApiOrigin()
  if (!o) return path
  if (o.startsWith('http://') || o.startsWith('https://')) return `${o}${path}`
  return `${o}${path}`
}

/**
 * @returns {Promise<{ liveEvents: any[], alerts: any[], dbMissing?: boolean }>}
 */
export async function fetchSnapshot() {
  const res = await fetch(apiUrl('/api/snapshot'))
  if (!res.ok) {
    throw new Error(`Snapshot failed (${res.status})`)
  }
  return res.json()
}

export async function runEngineOnServer() {
  const res = await fetch(apiUrl('/api/run-engine'), { method: 'POST' })
  if (!res.ok) {
    throw new Error(`Engine run failed (${res.status})`)
  }
  return res.json()
}

/** @returns {Promise<{ configured: boolean, model: string }>} */
export async function fetchAnalystChatStatus() {
  const res = await fetch(apiUrl('/api/analyst-chat/status'))
  if (!res.ok) {
    throw new Error(`Analyst chat status failed (${res.status})`)
  }
  return res.json()
}

/** @returns {Promise<{ tts: boolean, stt: boolean, ttsModel: string, sttModel: string, voiceId: string }>} */
export async function fetchVoiceStatus() {
  const res = await fetch(apiUrl('/api/voice/status'))
  if (!res.ok) {
    throw new Error(`Voice status failed (${res.status})`)
  }
  return res.json()
}

/**
 * @param {{ messages: { role: string, content: string }[], context?: object }} payload
 * @returns {Promise<{ reply: string }>}
 */
export async function postAnalystChat(payload) {
  const res = await fetch(apiUrl('/api/analyst-chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let detail = `Analyst chat failed (${res.status})`
    try {
      const j = await res.json()
      if (j?.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return res.json()
}

/**
 * @param {FormData} formData
 * @returns {Promise<{ text: string, rawText: string, averageConfidence?: number, uncertainTerms?: string[] }>}
 */
export async function postVoiceTranscription(formData) {
  const res = await fetch(apiUrl('/api/voice/transcribe'), {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    let detail = `Voice transcription failed (${res.status})`
    try {
      const j = await res.json()
      if (j?.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return res.json()
}

/**
 * @param {{ text: string }} payload
 * @returns {Promise<Blob>}
 */
export async function postVoiceSpeech(payload) {
  const res = await fetch(apiUrl('/api/voice/speak'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let detail = `Voice synthesis failed (${res.status})`
    try {
      const j = await res.json()
      if (j?.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return res.blob()
}
