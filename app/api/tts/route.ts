import { NextRequest, NextResponse } from 'next/server'

// ─── CURATED VOICE BANK ───────────────────────────────────────────────
// Hand-picked ElevenLabs built-in voices selected for ASMR quality.
// To add/remove voices: find voice IDs at elevenlabs.io/voice-library
// then update this list. The generator picks randomly from the matching pool.
// Each entry: { id: EL voice_id, name: display name }

interface VoiceEntry { id: string; name: string }

const VOICE_BANK: Record<string, Record<string, VoiceEntry[]>> = {
  female: {
    british: [
      { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice' },    // calm, elegant
      { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy' },   // warm, gentle
      { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily' },      // soft, intimate
    ],
    american: [
      { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },    // calm, clear
      { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },     // warm, breathy
      { id: 'piTKgcLEGmPE4e6mEKli', name: 'Nicole' },    // natural whisper
    ],
    australian: [
      { id: 'oWAxZDx7w5VEj9dCyTzz', name: 'Grace' },
    ],
    irish: [
      { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },    // no native premade — use Rachel
    ],
  },
  male: {
    british: [
      { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' },    // deep, calm
      { id: 'CYw3kZ28kcKqmElbDkAk', name: 'Dave' },      // warm, conversational
    ],
    american: [
      { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh' },      // deep, clear
      { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },      // calm, neutral
    ],
    australian: [
      { id: 'ZQe5CZNOzWyzPSCn5a3c', name: 'James' },
    ],
    irish: [
      { id: 'D38z5RcWu1voky8WS1ja', name: 'Fin' },
    ],
  },
}

function pickFromBank(gender: string, accent: string): string {
  const pool =
    VOICE_BANK[gender]?.[accent] ??
    VOICE_BANK[gender]?.['american'] ??
    VOICE_BANK['female']?.['american'] ??
    []
  if (pool.length === 0) return '21m00Tcm4TlvDq8ikWAM'  // Rachel — last resort
  const entry = pool[Math.floor(Math.random() * pool.length)]
  console.log(`[tts] voice bank → ${entry.name} (${entry.id}) [${gender}/${accent}]`)
  return entry.id
}

// (Shared voice library search removed — voice bank is now the primary selection)

// ─── HANDLER ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const {
      script,
      accent   = 'american',
      gender   = 'female',
      delivery = 'whisper',
      voiceId: voiceIdOverride,   // optional: audition page passes a specific ID
    } = await req.json()

    if (!script?.trim()) return NextResponse.json({ error: 'No script' }, { status: 400 })

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })

    // Audition mode: caller passed a specific voice ID to test
    // Normal mode: pick randomly from the curated voice bank
    const voiceId = voiceIdOverride ?? pickFromBank(gender, accent)
    console.log(`[tts] using voiceId=${voiceId}${voiceIdOverride ? ' (override)' : ''}`)

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
