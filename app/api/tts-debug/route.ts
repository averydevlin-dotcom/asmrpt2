// GET /api/tts-debug?accent=british&gender=female&delivery=whisper
// Returns what voice would be selected without generating audio.
// Also reports whether Voice Library access is available.

import { NextRequest, NextResponse } from 'next/server'

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

const ACCENT_MATCH: Record<string, string[]> = {
  british:    ['british', 'uk'],
  australian: ['australian', 'aussie'],
  irish:      ['irish'],
  american:   ['american'],
}

const PREMADE_VOICES: Record<string, Record<string, { id: string; name: string }[]>> = {
  female: {
    british:    [
      { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice' },
      { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy' },
      { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily' },
    ],
    american:   [
      { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
      { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },
    ],
    australian: [{ id: 'oWAxZDx7w5VEj9dCyTzz', name: 'Grace' }],
    irish:      [{ id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (fallback)' }],
  },
  male: {
    british:    [
      { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' },
      { id: 'CYw3kZ28kcKqmElbDkAk', name: 'Dave' },
    ],
    american:   [
      { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh' },
      { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },
    ],
    australian: [{ id: 'ZQe5CZNOzWyzPSCn5a3c', name: 'James' }],
    irish:      [{ id: 'D38z5RcWu1voky8WS1ja', name: 'Fin' }],
  },
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const accent   = searchParams.get('accent') ?? 'british'
  const gender   = searchParams.get('gender') ?? 'female'
  const delivery = searchParams.get('delivery') ?? 'whisper'

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })

  const searchTerm = delivery === 'whisper' ? 'whisper' : 'soft'
  const premade = PREMADE_VOICES[gender]?.[accent] ?? PREMADE_VOICES[gender]?.['american']

  try {
    const url = new URL('https://api.elevenlabs.io/v1/shared-voices')
    url.searchParams.set('search', searchTerm)
    url.searchParams.set('gender', gender)
    url.searchParams.set('page_size', '100')
    url.searchParams.set('sort', 'trending')

    const res = await fetch(url.toString(), { headers: { 'xi-api-key': apiKey } })

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({
        voice_library_access: false,
        message: `Voice Library API returned ${res.status}. Enable "Voice Library" in your ElevenLabs API key settings.`,
        using_premade_fallback: true,
        premade_voices_for_this_combo: premade,
        query: { accent, gender, delivery },
      })
    }

    if (!res.ok) {
      return NextResponse.json({ error: `EL API: ${res.status}` }, { status: res.status })
    }

    const data = await res.json()
    const voices: ELVoice[] = data.voices ?? []

    const scored = voices
      .map(v => ({
        name: v.name,
        voice_id: v.voice_id,
        score: accentScore(v, accent),
        accent_label: v.labels?.accent ?? 'none',
        gender_label: v.labels?.gender ?? 'none',
      }))
      .sort((a, b) => b.score - a.score)

    const matched = scored.filter(v => v.score > 0)

    return NextResponse.json({
      voice_library_access: true,
      query: { accent, gender, delivery, searchTerm },
      total_results: voices.length,
      accent_matched: matched.length,
      top_matched: matched.slice(0, 10),
      would_select_from: matched.length > 0 ? matched.slice(0, 5) : scored.slice(0, 5),
      using_premade_fallback: matched.length === 0,
      premade_fallback: premade,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
