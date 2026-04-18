import { explainConfidence } from './correlationEngine.js'
import { auroraApiConfigured, postSynthesizeAlert } from '../api/auroraClient.js'

/**
 * Synthesize a human-readable alert from a correlated cluster of events.
 * Uses the FastAPI + OpenRouter path when the dashboard API is configured (same-origin /api).
 * Direct browser calls to Anthropic are not possible (CORS + key must stay server-side).
 *
 * Returns an AlertExplanation object:
 * {
 *   headline:       string,
 *   summary:        string,
 *   recommendation: string,
 *   uncertainty:    string,
 * }
 */
export async function synthesizeAlert(incident, params) {
  const { events, score, region } = incident
  const factors = explainConfidence(events, params)
  const eventList = events
    .map(e => `[${e.type.toUpperCase()}] ${e.title} (${e.severity}) — ${e.detail}`)
    .join('\n')

  const prompt = `You are an AI analyst at a defense fusion operations center.
Analyze these correlated signals detected near ${region} and generate a concise alert card.

Events detected within ${factors.spanMin} minutes and ${factors.maxDistMi} miles:
${eventList}

Fusion confidence score: ${score}/100
Domains involved: ${factors.types.join(', ')}
Signal count: ${events.length}

Respond with ONLY a JSON object (no markdown, no preamble):
{
  "headline": "one sharp sentence under 15 words",
  "summary": "2-3 sentences: what happened and why signals may be connected",
  "recommendation": "one concrete analyst action step",
  "uncertainty": "one sentence about remaining unknowns"
}`

  if (auroraApiConfigured()) {
    try {
      return await postSynthesizeAlert({ prompt })
    } catch {
      return fallbackSynthesize(incident, factors)
    }
  }

  return fallbackSynthesize(incident, factors)
}

// Rule-based fallback when the API is unavailable
function fallbackSynthesize(incident, factors) {
  const { events, score, region } = incident
  const types = factors.types

  return {
    headline: `Possible coordinated activity near ${region}`,
    summary: `${events.length} signals across ${types.join(', ')} domains detected within ${factors.spanMin} min and ${factors.maxDistMi} mi. Pattern includes: ${events.slice(0, 2).map(e => e.title).join('; ')}.`,
    recommendation: 'Verify with physical security team. Cross-reference network logs for shared asset involvement.',
    uncertainty: `Geographic proximity may be coincidental. Source reliability and intent remain unconfirmed pending investigation.`,
  }
}
