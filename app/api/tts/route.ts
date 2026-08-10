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

// Keywords we look for in voice name / description / labels to match accent
const ACCENT_KEYWORDS: Record<string, string[]> = {
  british:    ['british', 'uk', 'english', 'england'],
  australian: ['australian', 'australia', 'aussie'],
  irish:      ['irish', 'ireland'],
  american:   ['american', 'us ', 'usa', 'north american'],
}

// Keywords we require in name / description / labels.description to confirm delivery type
const DELIVERY_KEYWORDS: Record<string, string[]> = {
  whisper: ['whisper', 'whispering', 'asmr', 'breathy', 'hushed'],
  soft:    ['soft', 'calm', 'gentle', 'sooth', 'relax', 'mellow', 'quiet', 'peaceful'],
}

// Search terms sent to EL API — ordered most-specific to most-generic
const DELIVERY_SEARCH_TERMS: Record<string, string[]> = {
  whisper: ['whisper asmr', 'asmr whisper', 'whisper'],
  soft:    ['soft calm', 'calm gentle', 'soft narrator', 'calm', 'soft'],
}

// ─── VOICE EXPLORER ──────────────────────────────────────────────────
// 1. Fetch voices from EL shared library matching delivery keyword + gender
// 2. Filter results: require BOTH accent AND delivery keywords present in
//    the voice's name, free-text description, or structured labels
// 3. Fall back progressively if no perfect match found

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

async function findVoice(
  apiKey: string,
  gender: string,
  accent: string,
  delivery: string
): Promise<string[]> {
  const cacheKey = `${gender}_${accent}_${delivery}`
  if (voiceCache.has(cacheKey)) return voiceCache.get(cacheKey)!

  const searchTerms = DELIVERY_SEARCH_TERMS[delivery] ?? DELIVERY_SEARCH_TERMS['soft']
  const accentKws   = ACCENT_KEYWORDS[accent] ?? [accent]
  const deliveryKws = DELIVERY_KEYWORDS[delivery] ?? DELIVERY_KEYWORDS['soft']

  let allVoices: ELVoice[] = []

  // Fetch voices from EL — try each search term until we get results
  for (const term of searchTerms) {
    try {
      const url = new URL('https://api.elevenlabs.io/v1/shared-voices')
      url.searchParams.set('search', term)
      url.searchParams.set('gender', gender)
      url.searchParams.set('page_size', '50') // fetch enough to filter down
      url.searchParams.set('sort', 'trending')

      const res = await fetch(url.toString(), { headers: { 'xi-api-key': apiKey } })
      if (!res.ok) continue

      const data = await res.json()
      if ((data.voices ?? []).length > 0) {
        allVoices = data.voices
        break
      }
    } catch { continue }
  }

  if (allVoices.length === 0) {
    // Hard fallback — known premade voices
    const ids = buildFallback(gender, delivery)
    voiceCache.set(cacheKey, ids)
    return ids
  }

  // Priority 1: voice matches BOTH accent AND delivery in name/description/labels
  const bothMatch = allVoices.filter(v =>
    matchesKeywords(v, accentKws) && matchesKeywords(v, deliveryKws)
  )

  // Priority 2: at least matches the delivery type
  const deliveryMatch = allVoices.filter(v => matchesKeywords(v, deliveryKws))

  // Priority 3: anything returned (already filtered by delivery search term + gender)
  const pool = bothMatch.length > 0 ? bothMatch
             : deliveryMatch.length > 0 ? deliveryMatch
             : allVoices

  const ids = pool.slice(0, 5).map(v => v.voice_id)
  voiceCache.set(cacheKey, ids)
  return ids
}

function buildFallback(gender: string, delivery: string): string[] {
  if (delivery === 'whisper')
    return gender === 'male' ? ['TxGEqnHWrfWFTfGW9XjX'] : ['EXAVITQu4vr4xnSDxMaL']
  return gender === 'male' ? ['pNInz6obpgDQGcFmaJgB'] : ['21m00Tcm4TlvDq8ikWAM']
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
