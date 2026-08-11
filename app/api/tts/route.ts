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

// ─── PREMADE VOICE FALLBACK ───────────────────────────────────────────
// ElevenLabs premade voices with known accent/gender.
// Used when the Voice Library API is unavailable (401/403) or returns no matches.
// With stability=0.07 and (whispering) performance cue, these sound convincingly whispered.

const PREMADE_VOICES: Record<string, Record<string, string[]>> = {
  female: {
    british:    ['Xb7hH8MSUJpSbSDYk0k2', 'ThT5KcBeYPX3keUQqHPh', 'pFZP5JQG7iQjIQuC4Bku'], // Alice, Dorothy, Lily
    american:   ['21m00Tcm4TlvDq8ikWAM', 'EXAVITQu4vr4xnSDxMaL', 'piTKgcLEGmPE4e6mEKli'], // Rachel, Sarah/Bella, Nicole
    australian: ['oWAxZDx7w5VEj9dCyTzz'],  // Grace
    irish:      ['21m00Tcm4TlvDq8ikWAM'],   // no native premade — fallback to Rachel
  },
  male: {
    british:    ['onwK4e9ZLuTAKqWW03F9', 'CYw3kZ28kcKqmElbDkAk'],  // Daniel, Dave
    american:   ['TxGEqnHWrfWFTfGW9XjX', 'pNInz6obpgDQGcFmaJgB'], // Josh, Adam
    australian: ['ZQe5CZNOzWyzPSCn5a3c'],  // James
    irish:      ['D38z5RcWu1voky8WS1ja'],   // Fin
  },
}

function getPremadeVoice(gender: string, accent: string): string {
  const pool = PREMADE_VOICES[gender]?.[accent]
    ?? PREMADE_VOICES[gender]?.['american']
    ?? ['21m00Tcm4TlvDq8ikWAM']
  return pool[Math.floor(Math.random() * pool.length)]
}

// ─── ACCENT MATCHING ─────────────────────────────────────────────────

const ACCENT_MATCH: Record<string, string[]> = {
  british:    ['british', 'uk'],
  australian: ['australian', 'aussie'],
  irish:      ['irish'],
  american:   ['american'],
}

function wordMatch(text: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword}\\b`, 'i').test(text)
}

function accentScore(voice: ELVoice, accent: string): number {
  const keywords = ACCENT_MATCH[accent] ?? [accent]
  const label = (voice.labels?.accent ?? '').toLowerCase()
  const name  = voice.name
  const desc  = voice.description ?? ''
  if (keywords.some(k => label === k || label.includes(k))) return 3
  if (keywords.some(k => wordMatch(name, k))) return 2
  if (keywords.some(k => wordMatch(desc, k))) return 1
  return 0
}

// ─── VOICE CACHE ─────────────────────────────────────────────────────

const voiceCache: Map<string, string[]> = new Map()

// ─── VOICE FINDER ────────────────────────────────────────────────────
// 1. Try EL shared voice library (requires Voice Library API access)
// 2. If 401/403 or no accent matches → fall back to curated premade voices

async function findVoice(
  apiKey: string,
  gender: string,
  accent: string,
  delivery: string
): Promise<string[]> {
  const cacheKey = `${gender}_${accent}_${delivery}`
  if (voiceCache.has(cacheKey)) return voiceCache.get(cacheKey)!

  const searchTerm = delivery === 'whisper' ? 'whisper' : 'soft'

  try {
    const url = new URL('https://api.elevenlabs.io/v1/shared-voices')
    url.searchParams.set('search', searchTerm)
    url.searchParams.set('gender', gender)
    url.searchParams.set('page_size', '100')
    url.searchParams.set('sort', 'trending')

    const res = await fetch(url.toString(), { headers: { 'xi-api-key': apiKey } })

    // 401/403 = Voice Library not enabled for this API key → use premade voices
    if (res.status === 401 || res.status === 403) {
      console.log(`[tts] Voice Library API returned ${res.status} — using premade voice fallback`)
      const id = getPremadeVoice(gender, accent)
      console.log(`[tts] premade fallback: gender=${gender} accent=${accent} → voice=${id}`)
      voiceCache.set(cacheKey, [id])
      return [id]
    }

    if (!res.ok) throw new Error(`EL voices API: ${res.status}`)

    const data = await res.json()
    const voices: ELVoice[] = data.voices ?? []

    if (voices.length === 0) throw new Error('No voices returned')

    const scored = voices
      .map(v => ({ v, score: accentScore(v, accent) }))
      .sort((a, b) => b.score - a.score)

    // If no accent matches, try second search with accent term included
    let top5 = scored.filter(x => x.score > 0).slice(0, 5)
    if (top5.length === 0) {
      console.log(`[tts] no accent matches — retrying with "${accent} ${searchTerm}"`)
      const url2 = new URL('https://api.elevenlabs.io/v1/shared-voices')
      url2.searchParams.set('search', `${accent} ${searchTerm}`)
      url2.searchParams.set('gender', gender)
      url2.searchParams.set('page_size', '50')
      url2.searchParams.set('sort', 'trending')
      const res2 = await fetch(url2.toString(), { headers: { 'xi-api-key': apiKey } })
      if (res2.ok) {
        const data2 = await res2.json()
        const scored2 = (data2.voices ?? [])
          .map((v: ELVoice) => ({ v, score: accentScore(v, accent) }))
          .sort((a: {score: number}, b: {score: number}) => b.score - a.score)
        top5 = scored2.slice(0, 5)
      }
    }

    // Still nothing → premade fallback
    if (top5.length === 0) {
      console.log(`[tts] no accent matches after both searches — using premade fallback`)
      const id = getPremadeVoice(gender, accent)
      voiceCache.set(cacheKey, [id])
      return [id]
    }

    const ids = top5.map(x => x.v.voice_id)
    console.log(`[tts] found ${ids.length} voice(s) from library: ${top5.map(x => x.v.name).join(', ')}`)
    voiceCache.set(cacheKey, ids)
    return ids
  } catch (e) {
    console.error('[tts] findVoice error:', e)
    const id = getPremadeVoice(gender, accent)
    console.log(`[tts] error fallback: gender=${gender} accent=${accent} → voice=${id}`)
    voiceCache.set(cacheKey, [id])
    return [id]
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
    console.log(`[tts] using voiceId=${voiceId}`)

    const isWhisper = delivery === 'whisper'
    const stability = isWhisper ? 0.07 : 0.50
    const speed     = isWhisper ? 0.78 : 0.88
    const model     = isWhisper ? 'eleven_turbo_v2_5' : 'eleven_multilingual_v2'

    // Strip leading performance cues like "(whispering)" or "(softly)" —
    // ElevenLabs reads them literally rather than treating them as directions.
    const cleanScript = script.trim().replace(/^\([^)]{1,40}\)\s*/i, '').trim()

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanScript,
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
      console.error(`[tts] TTS call failed ${response.status}:`, err)
      return NextResponse.json({ error: err || `HTTP ${response.status}` }, { status: response.status })
    }

    const audioData = await response.arrayBuffer()
    return new NextResponse(audioData, { headers: { 'Content-Type': 'audio/mpeg' } })
  } catch (e) {
    console.error('[tts] error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
