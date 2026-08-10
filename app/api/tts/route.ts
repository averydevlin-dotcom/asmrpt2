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
// NOTE: 'english' removed from british — it matches American English voices too.
// Only use exact accent identifiers from EL's labels.

const ACCENT_MATCH: Record<string, string[]> = {
  british:    ['british', 'uk'],
  australian: ['australian', 'aussie'],
  irish:      ['irish'],
  american:   ['american'],
}

function accentScore(voice: ELVoice, accent: string): number {
  const keywords = ACCENT_MATCH[accent] ?? [accent]
  const label = (voice.labels?.accent ?? '').toLowerCase()
  const name  = voice.name.toLowerCase()
  const desc  = (voice.description ?? '').toLowerCase()
  // labels.accent exact/partial match is best
  if (keywords.some(k => label === k || label.includes(k))) return 3
  // voice name contains accent keyword
  if (keywords.some(k => name.includes(k))) return 2
  // description mentions accent
  if (keywords.some(k => desc.includes(k))) return 1
  return 0
}

// ─── VOICE CACHE ─────────────────────────────────────────────────────

const voiceCache: Map<string, string[]> = new Map()

// ─── VOICE FINDER ────────────────────────────────────────────────────

async function findVoice(
  apiKey: string,
  gender: string,
  accent: string,
  delivery: string
): Promise<{ ids: string[]; debug: object[] }> {
  const cacheKey = `${gender}_${accent}_${delivery}`
  if (voiceCache.has(cacheKey)) return { ids: voiceCache.get(cacheKey)!, debug: [] }

  const searchTerm = delivery === 'whisper' ? 'whisper' : 'soft'

  try {
    const url = new URL('https://api.elevenlabs.io/v1/shared-voices')
    url.searchParams.set('search', searchTerm)
    url.searchParams.set('gender', gender)
    url.searchParams.set('page_size', '100')
    url.searchParams.set('sort', 'trending')

    const res = await fetch(url.toString(), { headers: { 'xi-api-key': apiKey } })
    if (!res.ok) throw new Error(`EL voices API: ${res.status}`)

    const data = await res.json()
    const voices: ELVoice[] = data.voices ?? []

    if (voices.length === 0) throw new Error('No voices returned')

    // Score and sort
    const scored = voices
      .map(v => ({ v, score: accentScore(v, accent) }))
      .sort((a, b) => b.score - a.score)

    // Log top 10 for debugging
    const debugInfo = scored.slice(0, 10).map(x => ({
      name: x.v.name,
      id: x.v.voice_id,
      score: x.score,
      accent_label: x.v.labels?.accent ?? 'none',
      gender_label: x.v.labels?.gender ?? 'none',
    }))
    console.log(`[tts] findVoice: search="${searchTerm}" gender=${gender} accent=${accent}`)
    console.log(`[tts] top10:`, JSON.stringify(debugInfo))

    // If no accent matches at all (all score 0), do a second pass with accent in search
    let top5 = scored.filter(x => x.score > 0).slice(0, 5)
    if (top5.length === 0) {
      console.log(`[tts] no accent matches in first search, trying "${accent} ${searchTerm}"`)
      const url2 = new URL('https://api.elevenlabs.io/v1/shared-voices')
      url2.searchParams.set('search', `${accent} ${searchTerm}`)
      url2.searchParams.set('gender', gender)
      url2.searchParams.set('page_size', '50')
      url2.searchParams.set('sort', 'trending')
      const res2 = await fetch(url2.toString(), { headers: { 'xi-api-key': apiKey } })
      if (res2.ok) {
        const data2 = await res2.json()
        const voices2: ELVoice[] = data2.voices ?? []
        const scored2 = voices2
          .map(v => ({ v, score: accentScore(v, accent) }))
          .sort((a, b) => b.score - a.score)
        console.log(`[tts] second search top5:`, JSON.stringify(scored2.slice(0, 5).map(x => ({ name: x.v.name, score: x.score, accent_label: x.v.labels?.accent }))))
        top5 = scored2.slice(0, 5)
      }
    }

    // If still nothing, fall back to top 5 from original search
    if (top5.length === 0) {
      top5 = scored.slice(0, 5)
    }

    const ids = top5.map(x => x.v.voice_id)
    voiceCache.set(cacheKey, ids)
    return { ids, debug: debugInfo }
  } catch (e) {
    console.error('[tts] findVoice error:', e)
    const fallback = delivery === 'whisper'
      ? (gender === 'male' ? ['TxGEqnHWrfWFTfGW9XjX'] : ['EXAVITQu4vr4xnSDxMaL'])
      : (gender === 'male' ? ['pNInz6obpgDQGcFmaJgB'] : ['21m00Tcm4TlvDq8ikWAM'])
    voiceCache.set(cacheKey, fallback)
    return { ids: fallback, debug: [] }
  }
}

// ─── HANDLER ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { script, accent = 'american', gender = 'female', delivery = 'whisper' } = await req.json()

    if (!script?.trim()) return NextResponse.json({ error: 'No script' }, { status: 400 })

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })

    const { ids } = await findVoice(apiKey, gender, accent, delivery)
    const voiceId = ids[Math.floor(Math.random() * ids.length)]
    console.log(`[tts] selected voiceId=${voiceId} from pool of ${ids.length}`)

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
      console.error(`[tts] TTS call failed: ${response.status}`, err)
      return NextResponse.json({ error: err || `HTTP ${response.status}` }, { status: response.status })
    }

    const audioData = await response.arrayBuffer()
    return new NextResponse(audioData, { headers: { 'Content-Type': 'audio/mpeg' } })
  } catch (e) {
    console.error('[tts] error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
