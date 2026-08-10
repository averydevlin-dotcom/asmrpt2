// GET /api/tts-debug?accent=british&gender=female&delivery=whisper
// Returns the raw voice search results so you can see exactly what voices
// would be selected, without generating any audio.

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

function accentScore(voice: ELVoice, accent: string): number {
  const keywords = ACCENT_MATCH[accent] ?? [accent]
  const label = (voice.labels?.accent ?? '').toLowerCase()
  const name  = voice.name.toLowerCase()
  const desc  = (voice.description ?? '').toLowerCase()
  if (keywords.some(k => label === k || label.includes(k))) return 3
  if (keywords.some(k => name.includes(k))) return 2
  if (keywords.some(k => desc.includes(k))) return 1
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

  try {
    const url = new URL('https://api.elevenlabs.io/v1/shared-voices')
    url.searchParams.set('search', searchTerm)
    url.searchParams.set('gender', gender)
    url.searchParams.set('page_size', '100')
    url.searchParams.set('sort', 'trending')

    const res = await fetch(url.toString(), { headers: { 'xi-api-key': apiKey } })
    if (!res.ok) return NextResponse.json({ error: `EL API: ${res.status}` }, { status: res.status })

    const data = await res.json()
    const voices: ELVoice[] = data.voices ?? []

    const scored = voices
      .map(v => ({
        name: v.name,
        voice_id: v.voice_id,
        score: accentScore(v, accent),
        labels: v.labels,
        description: v.description?.slice(0, 80),
      }))
      .sort((a, b) => b.score - a.score)

    const withAccent    = scored.filter(v => v.score > 0)
    const withoutAccent = scored.filter(v => v.score === 0)

    return NextResponse.json({
      query: { accent, gender, delivery, searchTerm },
      total: voices.length,
      matched_accent: withAccent.length,
      top_matched: withAccent.slice(0, 10),
      top_unmatched: withoutAccent.slice(0, 5),
      would_select_from: withAccent.length > 0 ? withAccent.slice(0, 5) : scored.slice(0, 5),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
