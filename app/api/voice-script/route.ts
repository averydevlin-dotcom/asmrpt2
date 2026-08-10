import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── DETERMINISTIC DETECTION ─────────────────────────────────────────
// Don't rely on Haiku to detect delivery/accent/gender — do it with regex
// so we always get the right values. Haiku's only job is to write the script.

function detectDelivery(input: string): 'whisper' | 'soft' {
  if (/whisper/i.test(input)) return 'whisper'
  return 'soft'
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
  const d = delivery === 'whisper' ? 'whisper' : 'soft voice'
  const g = gender === 'male' ? 'male' : 'female'
  return `${a}${g} ${d}`.trim()
}

// ─── HAIKU SCRIPT WRITER ─────────────────────────────────────────────
// Only writes the narration script — accent/gender/delivery are already known.

function buildScriptPrompt(delivery: 'whisper' | 'soft'): string {
  if (delivery === 'whisper') {
    return `You write intimate ASMR whisper scripts. Given a scene description, write a short narration.

Rules:
- Start with the literal text "(whispering)" — this is a required performance cue for the voice engine
- 40-55 words after the cue
- Second-person present tense: "You settle in...", "Feel the warmth..."
- Very short sentences separated by ellipses (...)
- Breathy, sensory language — texture, temperature, sound, breath
- No exclamation marks

Example: "(whispering) You're here now... The rain taps softly against the glass... Feel the warmth around you... Just breathe... in... and out... Everything is still... You're safe..."

Respond with ONLY the script text, no JSON, no quotes.`
  }
  return `You write calm ASMR narration scripts. Given a scene description, write a short narration.

Rules:
- Start with the literal text "(softly)" — this is a required performance cue for the voice engine
- 40-55 words after the cue
- Second-person present tense: "You settle in...", "Feel the warmth..."
- Unhurried pacing with ellipses (...)
- Warm, sensory language — texture, temperature, sound
- No exclamation marks

Example: "(softly) You settle into the warmth of the room... The fire crackles gently nearby... Outside the rain falls in a steady rhythm... You have nowhere to be... Just this moment..."

Respond with ONLY the script text, no JSON, no quotes.`
}

// ─── HANDLER ─────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { input } = await req.json()
    if (!input?.trim()) return Response.json({ error: 'No input' }, { status: 400 })

    // Detect all three deterministically — never trust Haiku for these
    const delivery = detectDelivery(input)
    const gender   = detectGender(input)
    const accent   = detectAccent(input)
    const label    = buildLabel(accent, gender, delivery)

    // Only ask Haiku to write the actual script for this scene
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: buildScriptPrompt(delivery),
      messages: [{ role: 'user', content: input.trim() }],
    })

    const script = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    if (!script) return Response.json({ error: 'Script generation failed' }, { status: 500 })

    return Response.json({ script, accent, gender, delivery, label })
  } catch (e) {
    console.error('voice-script error:', e)
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
