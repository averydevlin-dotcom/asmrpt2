import { NextRequest, NextResponse } from 'next/server'

// ─── TYPES ───────────────────────────────────────────────────────────

interface ELVoice {
  voice_id: string
  name: string
  description?: string
  labels?: {
    accent?: string
    description?: string
    age?: string
    gender?: string
    'use case'?: string
  }
}

// ─── KEYWORD MAPS ────────────────────────────────────────────────────

const ACCENT_KEYWORDS: Record<string, string[]> = {
  british:    ['british', 'uk', 'english', 'england'],
  australian: ['australian', 'australia', 'aussie'],
  irish:      ['irish', 'ireland'],
  american:   ['american', 'us ', 'usa', 'north american'],
}

const DELIVERY_KEYWORDS: Record<string, string[]> = {
  whisper: ['whisper', 'whispering', 'asmr', 'breathy', 'hushed'],
  soft:    ['soft', 'calm', 'gentle', 'sooth', 'mellow', 'quiet', 'peaceful', 'relax'],
}

// ─── VOICE SEARCH ────────────────────────────────────────────────────

const voiceCache: Map<string, string[]> = new Map()

function matchesKeywords(voice: ELVoice, keywords: string[]): boolean {
  const haystack = [
    voice.name ?? '',
    voice.description ?? '',
    voice.labels?.accent ?? '',
    voice.labels?.description ?? '',
    voice.labels?.['use case'] ?? '',
  ].join(' ').toLowerCase()
  return keywords.some(kw => haystack.includes(kw))
}

async function fetchVoices(apiKey: string, search: string, gender: string, pageSize = 20): Promise<ELVoice[]> {
  try {
    const url = new URL('https://api.elevenlabs.io/v1/shared-voices')
    url.searchParams.set('search', search)
    url.searchParams.set('gender', gender)
    url.searchParams.set('page_size', String(pageSize))
    url.searchParams.set('sort', 'trending')
    const res = await fetch(url.toString(), { headers: { 'xi-api-key': apiKey } })
    if (!res.ok) return []
    const data = await res.json()
    return data.voices ?? []
  } catch { return [] }
}

async function findVoice(apiKey: string, gender: string, accent: string, delivery: string): Promise<string[]> {
  const cacheKey = `${gender}_${accent}_${delivery}`
  if (voiceCache.has(cacheKey)) return voiceCache.get(cacheKey)!

  const accentKws   = ACCENT_KEYWORDS[accent] ?? [accent]
  const deliveryKws = DELIVERY_KEYWORDS[delivery] ?? DELIVERY_KEYWORDS['soft']

  // ── Pass 1: combined search "british whisper" — EL's own search engine handles it ──
  if (accent !== 'american') {
    const combined = await fetchVoices(apiKey, `${accent} ${delivery}`, gender, 20)
    const bothMatch = combined.filter(v => matchesKeywords(v, accentKws) && matchesKeywords(v, deliveryKws))
    if (bothMatch.length > 0) {
      const ids = bothMatch.slice(0, 5).map(v => v.voice_id)
      voiceCache.set(cacheKey, ids); return ids
    }
  }

  // ── Pass 2: search delivery keyword + gender, filter results for accent ──
  const deliveryTerms = delivery === 'whisper'
    ? ['whisper asmr', 'asmr whisper', 'whisper']
    : ['soft calm', 'calm gentle', 'soft narrator', 'soft']

  for (const term of deliveryTerms) {
    const voices = await fetchVoices(apiKey, term, gender, 50)
    const accentMatch = voices.filter(v => matchesKeywords(v, accentKws))
    if (accentMatch.length > 0) {
      const ids = accentMatch.slice(0, 5).map(v => v.voice_id)
      voiceCache.set(cacheKey, ids); return ids
    }
    // No accent match — save delivery-only results as a fallback
    const deliveryMatch = voices.filter(v => matchesKeywords(v, deliveryKws))
    if (deliveryMatch.length > 0) {
      const ids = deliveryMatch.slice(0, 5).map(v => v.voice_id)
      voiceCache.set(cacheKey, ids); return ids
    }
  }

  // ── Pass 3: hard fallback — at least gets the delivery right ──
  const hardFallback = delivery === 'whisper'
    ? (gender === 'male' ? ['TxGEqnHWrfWFTfGW9XjX'] : ['EXAVITQu4vr4xnSDxMaL'])
    : (gender === 'male' ? ['pNInz6obpgDQGcFmaJgB'] : ['21m00Tcm4TlvDq8ikWAM'])
  voiceCache.set(cacheKey, hardFallback)
  return hardFallback
}

// ─── HANDLER ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { script, accent = 'american', gender = 'female', delivery = 'soft' } = await req.json()

    if (!script?.trim()) return NextResponse.json({ error: 'No script' }, { status: 400 })

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })

    const ids = await findVoice(apiKey, gender, accent, delivery)
    const voiceId = ids[Math.floor(Math.random() * ids.length)]

    const isWhisper = delivery === 'whisper'
    const stability = isWhisper ? 0.07 : 0.50
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
