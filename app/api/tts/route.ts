import { NextRequest, NextResponse } from 'next/server'

// Curated ElevenLabs voice roster
// Update IDs from: elevenlabs.io/voice-library
// Format: stability, similarity_boost, style, speed — tuned for calm ASMR delivery
const VOICE_ROSTER: Record<string, { voiceId: string; stability: number; similarity_boost: number; style: number; speed: number }> = {
  // American female
  american_female_soft:    { voiceId: '21m00Tcm4TlvDq8ikWAM', stability: 0.55, similarity_boost: 0.80, style: 0.05, speed: 0.88 },
  american_female_whisper: { voiceId: 'EXAVITQu4vr4xnSDxMaL', stability: 0.30, similarity_boost: 0.80, style: 0.02, speed: 0.82 },
  // American male
  american_male_soft:      { voiceId: 'pNInz6obpgDQGcFmaJgB', stability: 0.55, similarity_boost: 0.80, style: 0.05, speed: 0.88 },
  american_male_whisper:   { voiceId: 'TxGEqnHWrfWFTfGW9XjX', stability: 0.30, similarity_boost: 0.80, style: 0.02, speed: 0.82 },
  // British female
  british_female_soft:     { voiceId: 'XB0fDUnXU5powFXDhCwa', stability: 0.55, similarity_boost: 0.80, style: 0.05, speed: 0.88 },
  british_female_whisper:  { voiceId: 'XB0fDUnXU5powFXDhCwa', stability: 0.28, similarity_boost: 0.80, style: 0.02, speed: 0.82 },
  // British male
  british_male_soft:       { voiceId: 'JBFqnCBsd6RMkjVDRZzb', stability: 0.55, similarity_boost: 0.80, style: 0.05, speed: 0.88 },
  british_male_whisper:    { voiceId: 'JBFqnCBsd6RMkjVDRZzb', stability: 0.28, similarity_boost: 0.80, style: 0.02, speed: 0.82 },
  // Australian — swap in real AU voice IDs from ElevenLabs voice library for best results
  australian_female_soft:    { voiceId: '21m00Tcm4TlvDq8ikWAM', stability: 0.55, similarity_boost: 0.80, style: 0.05, speed: 0.88 },
  australian_female_whisper: { voiceId: 'EXAVITQu4vr4xnSDxMaL', stability: 0.30, similarity_boost: 0.80, style: 0.02, speed: 0.82 },
  australian_male_soft:      { voiceId: 'pNInz6obpgDQGcFmaJgB', stability: 0.55, similarity_boost: 0.80, style: 0.05, speed: 0.88 },
  australian_male_whisper:   { voiceId: 'TxGEqnHWrfWFTfGW9XjX', stability: 0.30, similarity_boost: 0.80, style: 0.02, speed: 0.82 },
  // Irish — swap in real Irish voice IDs for best results
  irish_female_soft:    { voiceId: 'XB0fDUnXU5powFXDhCwa', stability: 0.55, similarity_boost: 0.80, style: 0.05, speed: 0.88 },
  irish_female_whisper: { voiceId: 'XB0fDUnXU5powFXDhCwa', stability: 0.28, similarity_boost: 0.80, style: 0.02, speed: 0.82 },
  irish_male_soft:      { voiceId: 'JBFqnCBsd6RMkjVDRZzb', stability: 0.55, similarity_boost: 0.80, style: 0.05, speed: 0.88 },
  irish_male_whisper:   { voiceId: 'JBFqnCBsd6RMkjVDRZzb', stability: 0.28, similarity_boost: 0.80, style: 0.02, speed: 0.82 },
}

function pickVoice(accent: string, gender: string, delivery: string) {
  const key = `${accent}_${gender}_${delivery}`
  return VOICE_ROSTER[key] ?? VOICE_ROSTER['american_female_soft']
}

export async function POST(req: NextRequest) {
  try {
    const { script, accent = 'american', gender = 'female', delivery = 'soft' } = await req.json()

    if (!script?.trim()) return NextResponse.json({ error: 'No script' }, { status: 400 })

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })

    const voice = pickVoice(accent, gender, delivery)

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: script.trim(),
        model_id: 'eleven_multilingual_v2',
        // speed is a top-level param, NOT inside voice_settings
        speed: voice.speed,
        voice_settings: {
          stability: voice.stability,
          similarity_boost: voice.similarity_boost,
          use_speaker_boost: false,
          // style omitted — requires Creator plan; remove if causing 422
        },
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return NextResponse.json({ error: err || `HTTP ${response.status}` }, { status: response.status })
    }

    const audioData = await response.arrayBuffer()
    return new NextResponse(audioData, {
      headers: { 'Content-Type': 'audio/mpeg' },
    })
  } catch (e) {
    console.error('tts error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
