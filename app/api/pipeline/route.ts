import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── VOICE DETECTION (deterministic regex — never guessed) ───────────

// Delivery: 'whisper' = breathy/airy; 'calm' = gentle speaking voice (default)
function detectDelivery(input: string): 'whisper' | 'calm' {
  if (/whisper/i.test(input)) return 'whisper'
  return 'calm'
}

function detectGender(input: string): 'female' | 'male' {
  if (/\b(male|man\b|men\b|guy|gentleman|his\s+voice|boy)\b/i.test(input)) return 'male'
  return 'female'  // default: female
}

function detectAccent(input: string): string {
  if (/\b(british|england|english\s+accent|uk\s+accent)\b/i.test(input)) return 'british'
  if (/\b(australian|aussie|australia)\b/i.test(input)) return 'australian'
  if (/\b(irish|ireland)\b/i.test(input)) return 'irish'
  if (/\bamerican\b/i.test(input)) return 'american'
  // Generic "accent" without specifying which → british
  if (/\baccent\b/i.test(input)) return 'british'
  return 'american'  // default: american when no accent mentioned
}

function buildLabel(accent: string, gender: string, delivery: string): string {
  const a = accent === 'american' ? '' : accent.charAt(0).toUpperCase() + accent.slice(1) + ' '
  const g = gender === 'male' ? 'male' : 'female'
  const d = delivery === 'whisper' ? 'whisper' : 'calm voice'
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

// ─── EXPLICIT TOPIC EXTRACTION ───────────────────────────────────────
// Detects when the user specified *what* the voice should talk about,
// as opposed to just setting a scene or voice type.
// e.g. "man whispering about how amazing I am" → "how amazing I am"
//      "someone telling me a story about dragons" → "a story about dragons"

function extractExplicitTopic(input: string): string | null {
  // "about X" pattern — most common
  const about = input.match(/\babout\s+([^.]{5,120}?)(?:\.|$)/i)
  if (about) return about[1].trim()
  // "telling me / tell me X"
  const tell = input.match(/\btell(?:ing)?\s+me\s+([^.]{5,120}?)(?:\.|$)/i)
  if (tell) return tell[1].trim()
  // "saying / say X"
  const say = input.match(/\bsay(?:ing)?\s+([^.]{5,120}?)(?:\.|$)/i)
  if (say) return say[1].trim()
  // "whispering that X"
  const that = input.match(/\bwhisper(?:ing)?\s+that\s+([^.]{5,120}?)(?:\.|$)/i)
  if (that) return that[1].trim()
  return null
}

// ─── VOICE-ONLY DETECTION ────────────────────────────────────────────
// Returns true when the request is purely a voice with no real scene —
// either because the user gave an explicit script topic (no sounds needed)
// or because the stripped description is too sparse to be a scene.

const SCENE_WORDS = /\b(forest|woods|ocean|beach|rain|fire|fireplace|caf[eé]|library|park|garden|stream|river|mountain|field|meadow|city|street|kitchen|bedroom|studio|office|nature|water|wind|leaves|sand|snow|night|morning|evening|outside|candle)\b/i
const ACTIVITY_WORDS = /\b(painting|walking|writing|reading|cooking|eating|drinking|drawing|knitting|folding|brushing|typing|studying|working|gardening|hiking|swimming|journaling)\b/i

function isVoiceOnly(ambientDesc: string, explicitTopic: string | null): boolean {
  if (explicitTopic) return true              // explicit topic = voice script, no sounds
  if (!ambientDesc || ambientDesc.length < 6) return true  // nothing left after stripping
  if (SCENE_WORDS.test(ambientDesc) || ACTIVITY_WORDS.test(ambientDesc)) return false
  // Short pronoun/preposition fragments like "to me", "for me" — not a real scene
  return ambientDesc.trim().split(/\s+/).length < 3
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

For SEQUENCE mode:
  STEP 1 — Add a background ambient (background:true) that fits the location and sets the scene atmosphere. This always plays underneath everything:
    - Beach/sand/ocean → soft distant waves lapping
    - Forest/nature → gentle wind through leaves, distant birdsong
    - Indoors cozy → room tone, fireplace crackle, or rain on window
    - Cafe/library → soft distant murmur, HVAC hum
    - Night → quiet crickets, distant wind
    If no natural ambient fits, use a soft room-tone presence sound.

  STEP 2 — Pick 1–2 action sounds (background:false) that form the sequence. Keep it minimal.
    CRITICAL RULES for action sounds:
    - There must be exactly ONE "continuous" sound — the single defining physical action (footsteps in sand, brush on canvas, pen on paper). Only one.
    - Do NOT create multiple sounds that are textural variations of the same thing. "Footsteps in sand," "sand shifting underfoot," and "sand crunching" are all the same action — pick only ONE.
    - "occasional" sounds should be a genuinely distinct secondary event (brush dipping in water, turning a page, pausing to breathe). Not another version of the main action.
    - "setup" sounds are one-time preparatory actions (sitting down, uncapping a pen, pulling out a sheet of paper).
    - Frequency: "continuous" plays every loop, "occasional" every ~4 loops, "setup" once at start then every ~12 loops.

  Order: setup first, then continuous and occasional interleaved.

Rules for all sounds:
- Describe each sound as a close-up audible texture or action
- Use soft, ASMR-appropriate language
- Include "no music, no singing, no voice, no speech, no percussion" in every prompt
- Keep prompts under 28 words each

Respond with ONLY valid JSON, no other text:

Layer example:
{"mode":"layer","sounds":[{"label":"Rain on window","prompt":"soft rain pattering gently on glass, quiet close-up texture, no thunder, no music, no voice, no speech","background":false,"frequency":"continuous"}]}

Sequence example (walking slowly on a beach in dry sand):
{"mode":"sequence","sounds":[
  {"label":"Distant ocean waves","prompt":"soft ocean waves rolling gently onto shore, distant and soothing, no music, no voice, no speech","background":true,"frequency":"continuous"},
  {"label":"Footsteps in dry sand","prompt":"slow deliberate footsteps pressing softly into dry beach sand, each step quiet and close-up, no music, no voice, no speech","background":false,"frequency":"continuous"}
]}

Sequence example (watercolor painting):
{"mode":"sequence","sounds":[
  {"label":"Soft room ambience","prompt":"quiet indoor presence, faint natural room tone, gentle stillness, no music, no voice, no speech","background":true,"frequency":"continuous"},
  {"label":"Pouring water","prompt":"water pouring gently into a small glass jar, soft trickle, no music, no voice, no speech","background":false,"frequency":"setup"},
  {"label":"Brush stroke on canvas","prompt":"soft wet paintbrush strokes across watercolor paper, gentle scratching, no music, no voice, no speech","background":false,"frequency":"continuous"},
  {"label":"Brush dip in water","prompt":"wet paintbrush swirling briefly in water jar, soft swish, no music, no voice, no speech","background":false,"frequency":"occasional"}
]}`

type SoundFrequency = 'continuous' | 'occasional' | 'setup'

async function decomposeSounds(scene: string): Promise<{
  mode: 'layer' | 'sequence'
  sounds: { label: string; prompt: string; frequency: SoundFrequency; background: boolean }[]
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
  const rawSounds = Array.isArray(parsed.sounds) ? parsed.sounds : []
  return {
    mode: parsed.mode === 'sequence' ? 'sequence' : 'layer',
    sounds: rawSounds.map((s: { label: string; prompt: string; frequency?: string; rare?: boolean; background?: boolean }) => ({
      label: s.label,
      prompt: s.prompt,
      // Support both new frequency field and legacy rare boolean
      frequency: (['continuous','occasional','setup'].includes(s.frequency ?? '') ? s.frequency
        : s.rare === true ? 'occasional' : 'continuous') as SoundFrequency,
      background: s.background === true,
    })),
  }
}

// ─── VOICE SCRIPT WRITER ─────────────────────────────────────────────

function buildScriptSystem(
  delivery: 'whisper' | 'calm',
  explicitTopic: string | null,
  sceneContext: string,
): string {
  const cue = delivery === 'whisper' ? '(whispering)' : '(calmly)'

  let contentGuidance: string
  if (explicitTopic) {
    // User told us exactly what to talk about — do that, directly and genuinely.
    contentGuidance = `The listener has asked the narrator to speak about: "${explicitTopic}".
Write a script that is genuinely and directly about this topic. If they asked for compliments or affirmations, give real warm compliments. If they asked for a story, start the story. Speak directly to the listener as "you." Do NOT narrate or describe the narrator's voice or the act of whispering.`
  } else if (sceneContext) {
    // Scene exists — write something a real person would say in that setting.
    contentGuidance = `The setting is: ${sceneContext}.
Write something a person would naturally say or think in this place. Do NOT describe the act of whispering or narrate it — speak as someone actually present in the scene. Evoke the mood, sensation, and details of that specific environment. Speak directly to the listener as "you."`
  } else {
    // Pure voice request with no scene or topic — write gentle comfort/affirmations.
    contentGuidance = `Write gentle affirmations and soft reassurance — something calming and warm. Speak directly to the listener as "you," as if sitting close beside them.`
  }

  return `You write intimate ASMR narration scripts.
${contentGuidance}

Rules:
- Begin with the exact text "${cue}" — required performance cue, do not skip
- 40-55 words after the cue
- Second-person present tense: "You settle in...", "Feel the warmth..."
- Short phrases separated by ellipses (...)
- Sensory language: texture, temperature, sound, breath, weight
- No exclamation marks
- No quotes around the output

Respond with ONLY the script text.`
}

async function writeScript(
  delivery: 'whisper' | 'calm',
  explicitTopic: string | null,
  sceneContext: string,
  soundLabels: string,
): Promise<string> {
  const userMsg = soundLabels ? `Background sounds: ${soundLabels}` : 'No background sounds.'
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: buildScriptSystem(delivery, explicitTopic, sceneContext),
    messages: [{ role: 'user', content: userMsg }],
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

    // 3. Extract explicit script topic BEFORE stripping voice cues
    //    e.g. "about how amazing I am", "tell me a story about dragons"
    const explicitTopic = wantsVoice ? extractExplicitTopic(input) : null

    // 4. Strip voice cues → ambient scene description
    const ambientDesc = stripVoiceCues(input) || ''

    // 5. Determine if this is a voice-only request (no sounds needed)
    const voiceOnly = wantsVoice && isVoiceOnly(ambientDesc, explicitTopic)

    // 6. Decompose into sounds — skip entirely for voice-only requests
    let mode: 'layer' | 'sequence' = 'layer'
    let sounds: { label: string; prompt: string; frequency: SoundFrequency; background: boolean }[] = []

    if (!voiceOnly) {
      const sceneInput = ambientDesc || input.trim()
      try {
        const result = await decomposeSounds(sceneInput)
        mode = result.mode
        sounds = result.sounds
      } catch (e) {
        console.error('sound decompose failed:', e)
        sounds = [{
          label: sceneInput,
          prompt: `${sceneInput}, soft ambient ASMR texture, no music, no voice, no speech`,
          frequency: 'continuous',
          background: false,
        }]
      }
    }

    // 7. Write voice script — only if user requested a voice
    let script = ''
    if (wantsVoice) {
      const soundLabels = sounds.map(s => s.label).join(', ')
      // sceneContext: what the voice should speak *about* when no explicit topic
      const sceneContext = voiceOnly ? '' : (ambientDesc || soundLabels)
      try {
        script = await writeScript(delivery, explicitTopic, sceneContext, soundLabels)
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
