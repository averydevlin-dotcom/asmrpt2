import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── VOICE DETECTION (deterministic regex — never guessed) ───────────
// Default: american / female / whisper

function detectDelivery(input: string): 'whisper' | 'soft' {
  if (/whisper/i.test(input)) return 'whisper'
  if (/\b(soft|gentle|calm)\s+(voice|narrator|narration|speaking)\b/i.test(input)) return 'soft'
  return 'whisper' // default is always whisper
}

function detectGender(input: string): 'female' | 'male' {
  if (/\b(male|man\b|men\b|guy|gentleman|his\s+voice|boy)\b/i.test(input)) return 'male'
  return 'female'
}

function detectAccent(input: string): string {
  if (/\b(british|england|english\s+accent|uk\s+accent)\b/i.test(input)) return 'british'
  if (/\b(australian|aussie|australia)\b/i.test(input)) return 'australian'
  if (/\b(irish|ireland)\b/i.test(input)) return 'irish'
  return 'american'
}

function buildLabel(accent: string, gender: string, delivery: string): string {
  const a = accent === 'american' ? '' : accent.charAt(0).toUpperCase() + accent.slice(1) + ' '
  const g = gender === 'male' ? 'male' : 'female'
  const d = delivery === 'whisper' ? 'whisper' : 'soft voice'
  return `${a}${g} ${d}`.trim()
}

// ─── VOICE CUE STRIPPER ──────────────────────────────────────────────
// Removes voice/accent/delivery descriptors so only the ambient scene
// description is left for sound generation.

function stripVoiceCues(input: string): string {
  return input
    .replace(/\b(british|australian|irish)\b/gi, '')
    .replace(/\bwhisper\w*\b/gi, '')
    .replace(/\b(soft|gentle|calm)\s+(voice|narrator|narration|speaking)\b/gi, '')
    .replace(/\b(female|male)\s+(voice|narrator|narration)\b/gi, '')
    .replace(/\ba?\s*(woman|man)\s+(whispering|voice|narrator|narrating|speaking)\b/gi, '')
    .replace(/\b(soft|gentle)\s+(male|female|woman|man)\s*(voice|narrator)?\b/gi, '')
    .replace(/\b(female|male|woman|man)\s+whispering\b/gi, '')
    .replace(/\bnarrator\w*\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim()
}

// ─── SOUND DECOMPOSER ────────────────────────────────────────────────
// Haiku identifies 1–3 ambient sounds from the scene description.
// These feed DIRECTLY into ElevenLabs sound generation.

const SOUND_SYSTEM = `You are an ASMR sound scene decomposer for an AI sound generation app powered by ElevenLabs.
Given a description of a scene, identify 1-3 distinct ambient sounds that together paint that atmosphere.
Focus only on actual audible textures — not visuals, not people, not voice.
Each prompt will be sent directly to ElevenLabs sound generation.

Rules:
- Describe each sound as a continuous ambient texture
- Use soft, ASMR-appropriate language
- Include: "no music, no singing, no voice, no speech, no percussion" in each prompt
- Keep prompts under 25 words each

Respond with ONLY a valid JSON array, no other text:
[{"label": "Rain on window", "prompt": "soft rain pattering gently on glass, quiet close-up texture, no thunder, no music, no voice, no speech"}]`

async function decomposeSounds(scene: string): Promise<{ label: string; prompt: string }[]> {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: SOUND_SYSTEM,
    messages: [{ role: 'user', content: scene }],
  })
  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  return JSON.parse(cleaned)
}

// ─── VOICE SCRIPT WRITER ─────────────────────────────────────────────
// Haiku writes a narration ABOUT the specific sounds being generated —
// so the voice and the ambient audio are always about the same scene.

function buildScriptSystem(delivery: 'whisper' | 'soft'): string {
  const cue = delivery === 'whisper' ? '(whispering)' : '(softly)'
  return `You write intimate ASMR narration scripts.
You will receive a list of ambient sounds currently playing. Write a short narration that fits those sounds.

Rules:
- Begin with the exact text "${cue}" — this is a required performance cue for the voice engine, do not skip it
- 40-55 words after the cue
- Second-person present tense: "You settle in...", "Feel the warmth..."
- Short phrases separated by ellipses (...)
- Reference the specific sounds naturally — if rain is playing, mention it; if fire is crackling, include that
- Sensory language: texture, temperature, sound, breath, weight
- No exclamation marks
- No quotes around the output

Example for rain + fireplace: "(whispering) You're here now... The fire crackles softly beside you... Rain taps the window in a steady rhythm... Feel the warmth... Breathe slowly... You have nowhere to be..."

Respond with ONLY the script text.`
}

async function writeScript(soundLabels: string, delivery: 'whisper' | 'soft'): Promise<string> {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: buildScriptSystem(delivery),
    messages: [{ role: 'user', content: `Currently playing: ${soundLabels}` }],
  })
  return msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
}

// ─── HANDLER ─────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { input } = await req.json()
    if (!input?.trim()) return Response.json({ error: 'No input' }, { status: 400 })

    // 1. Detect voice params deterministically from full input
    const delivery = detectDelivery(input)
    const gender   = detectGender(input)
    const accent   = detectAccent(input)
    const label    = buildLabel(accent, gender, delivery)

    // 2. Strip voice cues → ambient scene for sound generation
    const ambientDesc = stripVoiceCues(input) || input.trim()

    // 3. Decompose ambient scene into ElevenLabs sound prompts
    let sounds: { label: string; prompt: string }[] = []
    try {
      sounds = await decomposeSounds(ambientDesc)
    } catch (e) {
      console.error('sound decompose failed:', e)
      // Fallback: treat the whole ambient description as one sound
      sounds = [{
        label: ambientDesc,
        prompt: `${ambientDesc}, soft ambient ASMR texture, no music, no voice, no speech`,
      }]
    }

    // 4. Write voice script ABOUT those specific sounds (sequential — script references sounds)
    const soundLabels = sounds.map(s => s.label).join(', ')
    let script = ''
    try {
      script = await writeScript(soundLabels || ambientDesc, delivery)
    } catch (e) {
      console.error('script write failed:', e)
    }

    return Response.json({
      voice: { script, accent, gender, delivery, label },
      sounds,
      ambientDesc,
    })
  } catch (e) {
    console.error('pipeline error:', e)
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
