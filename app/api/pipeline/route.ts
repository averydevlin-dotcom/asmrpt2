import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── VOICE DETECTION (deterministic regex — never guessed) ───────────

function detectDelivery(input: string): 'whisper' | 'soft' {
  if (/whisper/i.test(input)) return 'whisper'
  if (/\b(soft|gentle|calm)\s+(voice|narrator|narration|speaking)\b/i.test(input)) return 'soft'
  return 'whisper'
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

// ─── VOICE REQUEST DETECTION ─────────────────────────────────────────
// Only generate a voice component if the user explicitly asked for one.
// Ambient scenes (rain, fire, sand, etc.) get sound only.

function hasVoiceRequest(input: string): boolean {
  return (
    /\bwhisper\w*/i.test(input) ||
    /\b(narrator\w*|narration|narrating)\b/i.test(input) ||
    /\b(soft|gentle|calm)\s+(voice|narrator|narration|speaking)\b/i.test(input) ||
    /\b(female|male)\s+(voice|narrator|narration)\b/i.test(input) ||
    /\b(woman|man|girl|guy)\s+(whispering|speaking|narrating|talking)\b/i.test(input) ||
    /\b(british|australian|irish|american)\s+(woman|man|female|male|voice|accent)\b/i.test(input) ||
    /\basmr\s+(voice|narrator)\b/i.test(input)
  )
}

// ─── VOICE CUE STRIPPER ──────────────────────────────────────────────

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
// Haiku classifies the scene as layer (simultaneous ambient) or sequence
// (ordered actions that tell a story), then decomposes accordingly.

const SOUND_SYSTEM = `You are an ASMR sound scene decomposer for an AI sound generation app.

First, classify the playback MODE:
- "layer": an ambient environment or atmosphere where multiple sounds play simultaneously (fireplace + rain, forest stream, café background, ocean waves + wind)
- "sequence": a single focused activity with implied steps or motion, where sounds play one after another to tell a micro-story (walking in sand, watercolor on canvas, making tea, brushing hair, writing in a journal, folding paper, sharpening a pencil)

Then identify sounds based on the mode:

For LAYER mode: 1–3 simultaneous ambient textures that together paint the atmosphere.
For SEQUENCE mode: 2–4 ordered action sounds that form a narrative arc.
  - Each should be a specific moment or physical action, not a continuous loop
  - Order them as they'd naturally occur (e.g. brush dips in water → taps glass rim → strokes canvas)
  - Each clip should feel like a distinct moment, 3–10 seconds of sound

Rules for all sounds:
- Describe each sound as a close-up audible texture or action
- Use soft, ASMR-appropriate language
- Include "no music, no singing, no voice, no speech, no percussion" in every prompt
- Keep prompts under 28 words each

Respond with ONLY valid JSON, no other text:

Layer example:
{"mode":"layer","sounds":[{"label":"Rain on window","prompt":"soft rain pattering gently on glass, quiet close-up texture, no thunder, no music, no voice, no speech"}]}

Sequence example (watercolor):
{"mode":"sequence","sounds":[
  {"label":"Brush in water","prompt":"wet paintbrush swirling gently in water jar, soft swishing sound, no music, no voice, no speech"},
  {"label":"Tap on glass rim","prompt":"wet brush tapping lightly on glass jar rim, single light drip, no music, no voice, no speech"},
  {"label":"Stroke on canvas","prompt":"wet brush strokes slowly across watercolor paper, soft wet scratching, no music, no voice, no speech"}
]}`

async function decomposeSounds(scene: string): Promise<{
  mode: 'layer' | 'sequence'
  sounds: { label: string; prompt: string }[]
}> {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: SOUND_SYSTEM,
    messages: [{ role: 'user', content: scene }],
  })
  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  const parsed = JSON.parse(cleaned)
  return {
    mode: parsed.mode === 'sequence' ? 'sequence' : 'layer',
    sounds: Array.isArray(parsed.sounds) ? parsed.sounds : [],
  }
}

// ─── VOICE SCRIPT WRITER ─────────────────────────────────────────────

function buildScriptSystem(delivery: 'whisper' | 'soft', mode: 'layer' | 'sequence'): string {
  const cue = delivery === 'whisper' ? '(whispering)' : '(softly)'
  const context = mode === 'sequence'
    ? 'You will receive a list of sounds in a sequence — they play one after another.'
    : 'You will receive a list of ambient sounds that play simultaneously.'
  return `You write intimate ASMR narration scripts.
${context} Write a short narration that fits the overall scene.

Rules:
- Begin with the exact text "${cue}" — required performance cue, do not skip
- 40-55 words after the cue
- Second-person present tense: "You settle in...", "Feel the warmth..."
- Short phrases separated by ellipses (...)
- Reference the specific sounds naturally
- Sensory language: texture, temperature, sound, breath, weight
- No exclamation marks
- No quotes around the output

Respond with ONLY the script text.`
}

async function writeScript(soundLabels: string, delivery: 'whisper' | 'soft', mode: 'layer' | 'sequence'): Promise<string> {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: buildScriptSystem(delivery, mode),
    messages: [{ role: 'user', content: `Sounds: ${soundLabels}` }],
  })
  return msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
}

// ─── HANDLER ─────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { input } = await req.json()
    if (!input?.trim()) return Response.json({ error: 'No input' }, { status: 400 })

    // 1. Check if user asked for a voice/narrator at all
    const wantsVoice = hasVoiceRequest(input)

    // 2. Detect voice params (only used if wantsVoice)
    const delivery = wantsVoice ? detectDelivery(input) : 'whisper'
    const gender   = wantsVoice ? detectGender(input)   : 'female'
    const accent   = wantsVoice ? detectAccent(input)   : 'american'
    const label    = buildLabel(accent, gender, delivery)

    // 3. Strip voice cues → ambient scene description
    const ambientDesc = stripVoiceCues(input) || input.trim()

    // 4. Decompose into sounds + detect mode (layer vs sequence)
    let mode: 'layer' | 'sequence' = 'layer'
    let sounds: { label: string; prompt: string }[] = []
    try {
      const result = await decomposeSounds(ambientDesc)
      mode = result.mode
      sounds = result.sounds
    } catch (e) {
      console.error('sound decompose failed:', e)
      sounds = [{
        label: ambientDesc,
        prompt: `${ambientDesc}, soft ambient ASMR texture, no music, no voice, no speech`,
      }]
    }

    // 5. Write voice script — only if user requested a voice
    let script = ''
    if (wantsVoice) {
      const soundLabels = sounds.map(s => s.label).join(', ')
      try {
        script = await writeScript(soundLabels || ambientDesc, delivery, mode)
      } catch (e) {
        console.error('script write failed:', e)
      }
    }

    return Response.json({
      voice: wantsVoice && script ? { script, accent, gender, delivery, label } : null,
      sounds,
      ambientDesc,
      mode,
    })
  } catch (e) {
    console.error('pipeline error:', e)
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
