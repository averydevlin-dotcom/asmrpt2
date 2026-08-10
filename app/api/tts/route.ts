import { NextRequest, NextResponse } from 'next/server'

// ─── VOICE SEARCH ────────────────────────────────────────────────────
// For whisper delivery: query ElevenLabs shared voice library for voices
// that have "whisper" in their description. Cached in memory per gender+accent
// so we don't hammer the API on every request.

const voiceCache: Map<string, string[]> = new Map()

async function searchWhisperVoices(apiKey: string, gender: string, accent: string): Promise<string[]> {
  const cacheKey = `${gender}_${accent}`
  if (voiceCache.has(cacheKey)) return voiceCache.get(cacheKey)!

  // Try accent-specific first ("british whisper"), then generic ("whisper asmr")
  const terms = accent !== 'american'
    ? [`${accent} whisper`, 'whisper asmr', 'whisper']
    : ['whisper asmr', 'asmr whisper', 'whisper']

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

  // Fallback to known ASMR-friendly voices if library search returns nothing
  const fallback = gender === 'male'
    ? ['TxGEqnHWrfWFTfGW9XjX', 'pNInz6obpgDQGcFmaJgB']
    : ['EXAVITQu4vr4xnSDxMaL', 'XB0fDUnXU5powFXDhCwa']
  voiceCache.set(cacheKey, fallback)
  return fallback
}

// ─── SOFT VOICE ROSTER ───────────────────────────────────────────────
// For non-whisper delivery: curated premade voices, stable and warm.
// Update IDs from elevenlabs.io/voice-library for better accent coverage.

const SOFT_VOICES: Record<string, string> = {
  american_female: '21m00Tcm4TlvDq8ikWAM', // Rachel
  american_male:   'pNInz6obpgDQGcFmaJgB', // Adam
  british_female:  'XB0fDUnXU5powFXDhCwa', // Charlotte
  british_male:    'JBFqnCBsd6RMkjVDRZzb', // George
  australian_female: '21m00Tcm4TlvDq8ikWAM', // swap for AU voice when available
  australian_male:   'pNInz6obpgDQGcFmaJgB',
  irish_female:    'XB0fDUnXU5powFXDhCwa',
  irish_male:      'JBFqnCBsd6RMkjVDRZzb',
}

// ─── HANDLER ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { script, accent = 'american', gender = 'female', delivery = 'soft' } = await req.json()

    if (!script?.trim()) return NextResponse.json({ error: 'No script' }, { status: 400 })

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })

    let voiceId: string
    let stability: number
    let speed: number
    let model: string

    if (delivery === 'whisper') {
      // Dynamically pull a whisper voice from EL shared library
      const ids = await searchWhisperVoices(apiKey, gender, accent)
      // Rotate across top 5 results for variety across sessions
      voiceId = ids[Math.floor(Math.random() * Math.min(5, ids.length))]
      stability = 0.07   // very low = breathy, whispery quality
      speed     = 0.78   // slow and intimate
      model     = 'eleven_turbo_v2_5' // better nuanced delivery for whispers
    } else {
      // Soft narration — use stable premade voice, rich model
      voiceId   = SOFT_VOICES[`${accent}_${gender}`] ?? SOFT_VOICES['american_female']
      stability = 0.50
      speed     = 0.88
      model     = 'eleven_multilingual_v2'
    }

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
