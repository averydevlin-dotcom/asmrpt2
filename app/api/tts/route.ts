import { NextRequest, NextResponse } from 'next/server'

// ─── VOICE SEARCH ────────────────────────────────────────────────────
// Queries the ElevenLabs shared voice library combining BOTH accent and
// delivery type so "british whisper" finds a British-accented whisper voice
// and "soft american" finds a calm American narrator — not just any voice.
// Cached in memory per gender+accent+delivery to avoid repeated API calls.

const voiceCache: Map<string, string[]> = new Map()

async function searchVoices(
  apiKey: string,
  gender: string,
  accent: string,
  delivery: string
): Promise<string[]> {
  const cacheKey = `${gender}_${accent}_${delivery}`
  if (voiceCache.has(cacheKey)) return voiceCache.get(cacheKey)!

  // Search terms are ordered from most specific to most generic.
  // We try each until EL returns results, so accent+delivery is always attempted first.
  let terms: string[]
  if (delivery === 'whisper') {
    terms = accent !== 'american'
      ? [`${accent} whisper`, `${accent} asmr`, 'whisper asmr', 'asmr whisper', 'whisper']
      : ['asmr whisper', 'whisper asmr', 'whisper']
  } else {
    // soft / calm delivery
    terms = accent !== 'american'
      ? [`${accent} soft`, `${accent} calm`, `${accent} narrator`, accent, 'soft calm', 'calm narrator']
      : ['soft narrator', 'calm voice', 'gentle narrator', 'soft']
  }

  for (const term of terms) {
    try {
      const url = new URL('https://api.elevenlabs.io/v1/shared-voices')
      url.searchParams.set('search', term)
      url.searchParams.set('gender', gender)
      url.searchParams.set('page_size', '10')
      url.searchParams.set('sort', 'trending')

      const res = await fetch(url.toString(), { headers: { 'xi-api-key': apiKey } })
      if (!res.ok) continue

      const data = await res.json()
      const ids: string[] = (data.voices ?? []).map((v: { voice_id: string }) => v.voice_id)
      if (ids.length > 0) {
        voiceCache.set(cacheKey, ids)
        return ids
      }
    } catch { continue }
  }

  // Final fallback: known-good ElevenLabs premade voices
  const fallback = delivery === 'whisper'
    ? (gender === 'male' ? ['TxGEqnHWrfWFTfGW9XjX'] : ['EXAVITQu4vr4xnSDxMaL'])
    : (gender === 'male' ? ['pNInz6obpgDQGcFmaJgB'] : ['21m00Tcm4TlvDq8ikWAM'])
  voiceCache.set(cacheKey, fallback)
  return fallback
}

// ─── HANDLER ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { script, accent = 'american', gender = 'female', delivery = 'soft' } = await req.json()

    if (!script?.trim()) return NextResponse.json({ error: 'No script' }, { status: 400 })

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })

    // Find the best matching voice for this accent + delivery combination
    const ids = await searchVoices(apiKey, gender, accent, delivery)
    // Rotate across top 5 for variety across sessions
    const voiceId = ids[Math.floor(Math.random() * Math.min(5, ids.length))]

    // Voice settings differ significantly between whisper and soft delivery
    const isWhisper = delivery === 'whisper'
    const stability      = isWhisper ? 0.07 : 0.50  // low = breathy/whispery; high = stable/smooth
    const speed          = isWhisper ? 0.78 : 0.88
    const model          = isWhisper ? 'eleven_turbo_v2_5' : 'eleven_multilingual_v2'

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
