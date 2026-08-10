import { NextRequest, NextResponse } from 'next/server'

// Curated ElevenLabs voice roster
// Update IDs from: elevenlabs.io/voice-library
//
// Whisper tuning: stability must be very low (0.05–0.10) to get breathy delivery.
// eleven_turbo_v2_5 handles nuanced whisper better than eleven_multilingual_v2.
// Soft delivery uses eleven_multilingual_v2 for richer tone at normal stability.

interface VoiceConfig {
  voiceId: string
  stability: number
  similarity_boost: number
  speed: number
  model: string
}

const VOICE_ROSTER: Record<string, VoiceConfig> = {
  // American female
  american_female_soft:    { voiceId: '21m00Tcm4TlvDq8ikWAM', stability: 0.50, similarity_boost: 0.80, speed: 0.88, model: 'eleven_multilingual_v2' },
  american_female_whisper: { voiceId: 'EXAVITQu4vr4xnSDxMaL', stability: 0.07, similarity_boost: 0.85, speed: 0.78, model: 'eleven_turbo_v2_5' },
  // American male
  american_male_soft:      { voiceId: 'pNInz6obpgDQGcFmaJgB', stability: 0.50, similarity_boost: 0.80, speed: 0.88, model: 'eleven_multilingual_v2' },
  american_male_whisper:   { voiceId: 'TxGEqnHWrfWFTfGW9XjX', stability: 0.07, similarity_boost: 0.85, speed: 0.78, model: 'eleven_turbo_v2_5' },
  // British female
  british_female_soft:     { voiceId: 'XB0fDUnXU5powFXDhCwa', stability: 0.50, similarity_boost: 0.80, speed: 0.88, model: 'eleven_multilingual_v2' },
  british_female_whisper:  { voiceId: 'XB0fDUnXU5powFXDhCwa', stability: 0.07, similarity_boost: 0.85, speed: 0.78, model: 'eleven_turbo_v2_5' },
  // British male
  british_male_soft:       { voiceId: 'JBFqnCBsd6RMkjVDRZzb', stability: 0.50, similarity_boost: 0.80, speed: 0.88, model: 'eleven_multilingual_v2' },
  british_male_whisper:    { voiceId: 'JBFqnCBsd6RMkjVDRZzb', stability: 0.07, similarity_boost: 0.85, speed: 0.78, model: 'eleven_turbo_v2_5' },
  // Australian — swap in real AU voice IDs from ElevenLabs voice library for best results
  australian_female_soft:    { voiceId: '21m00Tcm4TlvDq8ikWAM', stability: 0.50, similarity_boost: 0.80, speed: 0.88, model: 'eleven_multilingual_v2' },
  australian_female_whisper: { voiceId: 'EXAVITQu4vr4xnSDxMaL', stability: 0.07, similarity_boost: 0.85, speed: 0.78, model: 'eleven_turbo_v2_5' },
  australian_male_soft:      { voiceId: 'pNInz6obpgDQGcFmaJgB', stability: 0.50, similarity_boost: 0.80, speed: 0.88, model: 'eleven_multilingual_v2' },
  australian_male_whisper:   { voiceId: 'TxGEqnHWrfWFTfGW9XjX', stability: 0.07, similarity_boost: 0.85, speed: 0.78, model: 'eleven_turbo_v2_5' },
  // Irish — swap in real Irish voice IDs for best results
  irish_female_soft:    { voiceId: 'XB0fDUnXU5powFXDhCwa', stability: 0.50, similarity_boost: 0.80, speed: 0.88, model: 'eleven_multilingual_v2' },
  irish_female_whisper: { voiceId: 'XB0fDUnXU5powFXDhCwa', stability: 0.07, similarity_boost: 0.85, speed: 0.78, model: 'eleven_turbo_v2_5' },
  irish_male_soft:      { voiceId: 'JBFqnCBsd6RMkjVDRZzb', stability: 0.50, similarity_boost: 0.80, speed: 0.88, model: 'eleven_multilingual_v2' },
  irish_male_whisper:   { voiceId: 'JBFqnCBsd6RMkjVDRZzb', stability: 0.07, similarity_boost: 0.85, speed: 0.78, model: 'eleven_turbo_v2_5' },
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
        model_id: voice.model,
        // speed is a top-level param, NOT inside voice_settings
        speed: voice.speed,
        voice_settings: {
          stability: voice.stability,
          similarity_boost: voice.similarity_boost,
          use_speaker_boost: false,
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
