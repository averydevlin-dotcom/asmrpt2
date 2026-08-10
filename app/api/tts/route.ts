import { NextRequest, NextResponse } from 'next/server'

// ─── TYPES ───────────────────────────────────────────────────────────

interface ELVoice {
  voice_id: string
  name: string
  description?: string
  labels?: {
    accent?: string
    description?: string
    gender?: string
    age?: string
    'use case'?: string
  }
}

// ─── ACCENT MATCHING ─────────────────────────────────────────────────
// ElevenLabs labels.accent values: "american", "british", "australian", "irish", etc.

const ACCENT_MATCH: Record<string, string[]> = {
  british:    ['british', 'uk', 'english'],
  australian: ['australian', 'aussie'],
  irish:      ['irish'],
  american:   ['american'],
}

function accentScore(voice: ELVoice, accent: string): number {
  const keywords = ACCENT_MATCH[accent] ?? [accent]
  const label = (voice.labels?.accent ?? '').toLowerCase()
  const name  = voice.name.toLowerCase()
  // Exact match in labels.accent is best; name match is second best
  if (keywords.some(k => label === k || label.includes(k))) return 2
  if (keywords.some(k => name.includes(k))) return 1
  return 0
}

// ─── VOICE CACHE ─────────────────────────────────────────────────────

const voiceCache: Map<string, string[]> = new Map()

// ─── VOICE FINDER ────────────────────────────────────────────────────
// Mirrors exactly what the user does in EL's UI:
//   1. Search "whisper" (or "soft") → gets 100+ results
//   2. Filter by gender (API param)
//   3. Filter by accent (client-side on labels.accent)

async function findVoice(
  apiKey: string,
  gender: string,
  accent: string,
  delivery: string
): Promise<string[]> {
  const cacheKey = `${gender}_${accent}_${delivery}`
  if (voiceCache.has(cacheKey)) return voiceCache.get(cacheKey)!

  // Search term mirrors EL's own search field: "whisper" or "soft"
  const searchTerm = delivery === 'whisper' ? 'whisper' : 'soft'

  try {
    const url = new URL('https://api.elevenlabs.io/v1/shared-voices')
    url.searchParams.set('search', searchTerm)
    url.searchParams.set('gender', gender)      // EL filters by labels.gender
    url.searchParams.set('page_size', '100')    // get enough to filter accent from
    url.searchParams.set('sort', 'trending')

    const res = await fetch(url.toString(), { headers: { 'xi-api-key': apiKey } })
    if (!res.ok) throw new Error(`EL voices API: ${res.status}`)

    const data = await res.json()
    const voices: ELVoice[] = data.voices ?? []

    if (voices.length === 0) throw new Error('No voices returned')

    // Score each voice by accent match, sort descending
    const scored = voices
      .map(v => ({ v, score: accentScore(v, accent) }))
      .sort((a, b) => b.score - a.score)

    // Take top 5 — if any have accent score > 0, those will be first
    const top5 = scored.slice(0, 5).map(x => x.v.voice_id)
    voiceCache.set(cacheKey, top5)
    return top5
  } catch (e) {
    console.error('findVoice error:', e)
    // Hard fallback — known ASMR-friendly EL premade voices
    const fallback = delivery === 'whisper'
      ? (gender === 'male' ? ['TxGEqnHWrfWFTfGW9XjX'] : ['EXAVITQu4vr4xnSDxMaL'])
      : (gender === 'male' ? ['pNInz6obpgDQGcFmaJgB'] : ['21m00Tcm4TlvDq8ikWAM'])
    voiceCache.set(cacheKey, fallback)
    return fallback
  }
}

// ─── HANDLER ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { script, accent = 'american', gender = 'female', delivery = 'whisper' } = await req.json()

    if (!script?.trim()) return NextResponse.json({ error: 'No script' }, { status: 400 })

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })

    const ids = await findVoice(apiKey, gender, accent, delivery)
    const voiceId = ids[Math.floor(Math.random() * ids.length)]

    const isWhisper = delivery === 'whisper'
    const stability = isWhisper ? 0.07 : 0.50   // very low = breathy whisper quality
    const speed     = isWhisper ? 0.78 : 0.88
    const model     = isWhisper ? 'eleven_turbo_v2_5' : 'eleven_multilingual_v2'

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: script.trim(),
        model_id: model,
        speed,
        voice_settings: {
          stability,
          similarity_boost: 0.85,
          use_speaker_boost: false,
        },
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return NextResponse.json({ error: err || `HTTP ${response.status}` }, { status: response.status })
    }

    const audioData = await response.arrayBuffer()
    return new NextResponse(audioData, { headers: { 'Content-Type': 'audio/mpeg' } })
  } catch (e) {
    console.error('tts error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
