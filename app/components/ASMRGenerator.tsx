'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

// ─── TYPES ───────────────────────────────────────────────────────────

type ComponentStatus = 'pending' | 'generating' | 'ready' | 'failed'

interface SoundComponent {
  id: string
  originalText: string
  enhancedPrompt: string
  displayLabel: string
  status: ComponentStatus
  volume: number
  audioBuffer?: AudioBuffer
  warning?: string
  retries?: number
  frequency?: 'continuous' | 'occasional' | 'setup'  // how often to include in sequence
  background?: boolean // sequence mode: true = loops in background while sequence plays
  voiceConfig?: { accent: string; gender: string; delivery: string; script: string }
  voiceName?: string  // resolved name from EL (e.g. "Trevor")
}

interface FilterSettings {
  presence: number
  air: number
  warmth: number
  smooth: number
}

type AppPhase = 'idle' | 'confirming' | 'generating' | 'ready'

interface AppState {
  phase: AppPhase
  components: SoundComponent[]
  filters: FilterSettings
  duration: number | null
  lastInput: string
  mode: 'layer' | 'sequence'
  currentSequenceId: string | null   // which step is playing in sequence mode
}

// ─── NEGATIVE CONSTRAINTS ────────────────────────────────────────────

const BASE_NEG = 'no music, no singing, no voice, no speech, no percussion, no sudden loud sounds, no reverb tail, no distortion, isolated ambient texture only'

function negFor(type: string): string {
  const extras: Record<string, string> = {
    fire:      'no explosions, no crackling pops',
    rain:      'no thunder, no wind howl',
    breathing: 'no words, no humming',
    water:     'no rushing rapids, no splashing',
    tapping:   'no drumming, no rhythmic music',
  }
  return extras[type] ? `${BASE_NEG}, ${extras[type]}` : BASE_NEG
}

// ─── SCENE ELEMENT DATABASE ──────────────────────────────────────────

interface SceneElement {
  patterns: RegExp[]
  label: string
  promptFn: () => string
  negType: string
}

const SCENE_ELEMENTS: SceneElement[] = [
  {
    patterns: [/\bwhittl\w*/i, /\bcarv\w+\b/i, /\bchisell?\w*/i, /\bwoodwork\w*/i],
    label: 'Wood carving',
    promptFn: () => 'slow rhythmic wood carving and knife scraping sounds, gentle whittling texture, natural organic ASMR, soft and calming',
    negType: 'tapping',
  },
  {
    patterns: [/\bknit\w*/i, /\bsew\w*/i, /\bcrochet\w*/i, /\bweav\w*/i],
    label: 'Knitting',
    promptFn: () => 'soft gentle knitting sounds, quiet rhythmic needle clicks, natural calming ASMR texture',
    negType: 'tapping',
  },
  {
    patterns: [/\bstir\w*/i, /\bcook\w*/i, /\bbak\w*/i],
    label: 'Soft stirring',
    promptFn: () => 'gentle soft stirring and mixing sounds, ceramic bowl, natural calming ASMR, quiet kitchen texture',
    negType: 'tapping',
  },
  {
    patterns: [/\bhair\s*brush\w*/i, /\bbrush\w+\s+hair/i, /\bcomb\w+\b/i],
    label: 'Hair brushing',
    promptFn: () => 'soft gentle hair brushing sounds, slow natural strokes, calming ASMR, quiet and soothing',
    negType: 'tapping',
  },
  {
    patterns: [/\bwrit\w+/i, /\bjournal\w*/i, /\bsketch\w*/i, /\bdraw\w+/i],
    label: 'Writing',
    promptFn: () => 'pencil and pen writing on paper, soft natural scratching, gentle calming ASMR close-up',
    negType: 'tapping',
  },
  {
    patterns: [/\btyp\w+/i, /\bkeyboard\b/i],
    label: 'Keyboard typing',
    promptFn: () => 'slow gentle keyboard typing, soft natural key clicks, quiet calming ASMR',
    negType: 'tapping',
  },
  {
    patterns: [/\bread\w*\s+book/i, /\bflip\w+\s+page/i, /\bpage\s+turn\w*/i, /\bleaf\w+\s+through/i],
    label: 'Page turning',
    promptFn: () => 'soft natural paper page turning, gentle book sounds, calming ASMR, quiet',
    negType: 'tapping',
  },
  {
    patterns: [/\brocking\s+chair\b/i, /\brock\w*\s+in\s+(a\s+)?chair/i],
    label: 'Rocking chair',
    promptFn: () => 'gentle rhythmic rocking chair creaking on wood floor, slow natural wood creak, calming ASMR',
    negType: 'tapping',
  },
  {
    patterns: [/\bclock\b/i, /\btick\w+\b/i],
    label: 'Clock ticking',
    promptFn: () => 'slow quiet clock ticking, soft rhythmic tick-tock, natural calming ASMR',
    negType: 'tapping',
  },
  {
    patterns: [/\bwind\s+chime\w*/i, /\bchime\w*/i],
    label: 'Wind chimes',
    promptFn: () => 'soft gentle wind chimes, delicate natural glass tones, calming ASMR, soothing',
    negType: 'tapping',
  },
  {
    patterns: [/\bcandle\w*/i, /\bflicker\w*/i],
    label: 'Candle flame',
    promptFn: () => 'soft small candle flame flickering, gentle quiet fire, natural calming ASMR',
    negType: 'fire',
  },
  {
    patterns: [/\bfire(place|side)?\b/i, /\bcrackl\w*/i, /\bhearth\b/i],
    label: 'Crackling fire',
    promptFn: () => 'cozy natural fireplace crackling, warm gentle fire sounds, calming ASMR, soft and soothing',
    negType: 'fire',
  },
  {
    patterns: [/\brain\b/i, /\brainfall\b/i, /\bdrizzl\w*/i, /\braindrop\w*/i],
    label: 'Rain',
    promptFn: () => 'gentle natural rainfall, soft soothing rain drops, peaceful calming ASMR',
    negType: 'rain',
  },
  {
    patterns: [/\bocean\b/i, /\bwaves?\b/i, /\bbeach\b/i, /\bseaside\b/i],
    label: 'Ocean waves',
    promptFn: () => 'soft natural ocean waves rolling gently, calming beach ASMR, peaceful and soothing',
    negType: 'water',
  },
  {
    patterns: [/\bstream\b/i, /\bcreek\b/i, /\brook\b/i, /\briver\b/i, /\bflow\w+\s+water/i],
    label: 'Flowing water',
    promptFn: () => 'gentle natural stream flowing, soft calming water sounds, peaceful ASMR',
    negType: 'water',
  },
  {
    patterns: [/\bleaves?\b/i, /\brustle\w*/i, /\bfoliage\b/i, /\bfern\w*/i],
    label: 'Rustling leaves',
    promptFn: () => 'leaves rustling gently in breeze, soft natural forest ASMR, calming and peaceful',
    negType: 'tapping',
  },
  {
    patterns: [/\bwind\b/i, /\bbreeze\b/i],
    label: 'Soft wind',
    promptFn: () => 'gentle soft natural wind, light calming breeze ASMR, soothing and peaceful',
    negType: 'rain',
  },
  {
    patterns: [/\bsnow\b/i, /\bwinter\b/i],
    label: 'Snow ambience',
    promptFn: () => 'soft snow falling, quiet winter ambience, gentle calming ASMR, peaceful',
    negType: 'rain',
  },
  {
    patterns: [/\bcafe\b/i, /\bcoffee\s+shop\b/i],
    label: 'Café ambience',
    promptFn: () => 'soft distant café ambience, gentle background murmur, calming coffee shop ASMR texture',
    negType: 'tapping',
  },
  {
    patterns: [/\bwhisper\w*/i, /\bmurmur\w*/i],
    label: 'Soft breathing',
    promptFn: () => 'soft natural breathing and gentle exhaling, calming ASMR, quiet and peaceful',
    negType: 'breathing',
  },
  {
    patterns: [/\bsleep\w*/i, /\bsnooz\w*/i, /\bnap\b/i],
    label: 'Soft breathing',
    promptFn: () => 'soft slow natural breathing, gentle sleeping sounds, very quiet calming ASMR',
    negType: 'breathing',
  },
  {
    patterns: [/\bcat\b/i, /\bkitten\b/i, /\bfeline\b/i],
    label: 'Purring',
    promptFn: () => 'cat purring softly and naturally, deep gentle calming vibration, soothing ASMR',
    negType: 'breathing',
  },
  {
    patterns: [/\btap\w*/i, /\bknock\w*/i, /\bclick\w*/i],
    label: 'Tapping',
    promptFn: () => 'gentle slow tapping sounds, natural organic texture, soft calming ASMR, quiet and soothing',
    negType: 'tapping',
  },
  {
    patterns: [/\bcrinkl\w*/i, /\brustle\w*/i, /\bwrap\w*/i],
    label: 'Crinkling',
    promptFn: () => 'soft paper crinkling naturally, gentle calming ASMR texture, quiet and soothing',
    negType: 'tapping',
  },
  {
    patterns: [/\bscratch\w*/i, /\bscrap\w*/i],
    label: 'Scratching',
    promptFn: () => 'light gentle scratching sounds, natural soft ASMR, calming and quiet',
    negType: 'tapping',
  },
  {
    patterns: [/\bbrush\w*/i, /\bstroke\w*/i],
    label: 'Brushing',
    promptFn: () => 'slow gentle brushing sounds, natural calming ASMR strokes, soft organic texture',
    negType: 'tapping',
  },
  {
    patterns: [/\bsand\b/i, /\bgravel\b/i],
    label: 'Sand',
    promptFn: () => 'soft sand moving gently, natural calming granular ASMR texture, soothing',
    negType: 'tapping',
  },
  {
    patterns: [/\bbird\w*/i, /\bbirdsong\b/i, /\bchirp\w*/i, /\bsongbird\w*/i, /\bdawn\b/i],
    label: 'Birdsong',
    promptFn: () => 'birds chirping softly at dawn, gentle natural birdsong, peaceful morning forest ASMR',
    negType: '',
  },
  {
    patterns: [/\bcricket\w*/i, /\bnight\s+insect\w*/i, /\bnight\s+sound\w*/i, /\bsummer\s+night\b/i],
    label: 'Night crickets',
    promptFn: () => 'crickets chirping on a warm summer night, gentle steady insect ambience, calming ASMR',
    negType: '',
  },
  {
    patterns: [/\bforest\b/i, /\bwoods\b/i, /\bwoodland\w*/i, /\bwild\w*\s+nature/i],
    label: 'Forest ambience',
    promptFn: () => 'deep forest ambience, gentle woodland soundscape with soft breeze and leaves, calming ASMR',
    negType: 'rain',
  },
  {
    patterns: [/\bwaterfall\b/i, /\bfalls\b/i, /\bcascade\b/i, /\bcataract\b/i],
    label: 'Waterfall',
    promptFn: () => 'gentle natural waterfall, soft steady cascade of water, calming peaceful ASMR',
    negType: 'water',
  },
  {
    patterns: [/\btent\b/i, /\bcamping\b/i, /\brain\s+on\b/i, /\bpatter\w*/i],
    label: 'Rain on tent',
    promptFn: () => 'rain pattering gently on tent canvas, soft camping rain, natural close-up ASMR texture',
    negType: 'rain',
  },
  {
    patterns: [/\bthunder\w*/i, /\bthunderstorm\b/i, /\bstorm\b/i],
    label: 'Distant thunder',
    promptFn: () => 'continuous low rolling thunder rumble in the far distance, sustained soft deep resonance, no sharp cracks, gentle storm ambience ASMR',
    negType: 'rain',
  },
  {
    patterns: [/\bcampfire\b/i, /\bbonfire\b/i, /\boutdoor\s+fire\b/i],
    label: 'Campfire outdoor',
    promptFn: () => 'outdoor campfire crackling at night, natural wood fire, soft gentle ASMR, no wind',
    negType: 'fire',
  },
  {
    patterns: [/\baquarium\b/i, /\bfish\s+tank\b/i, /\bfish\b/i, /\bbubbl\w+\s+water/i],
    label: 'Aquarium',
    promptFn: () => 'aquarium bubbling, gentle fish tank water filter, soft constant water bubbles, ASMR',
    negType: 'water',
  },
  {
    patterns: [/\bfan\b/i, /\bwhite\s+noise\b/i, /\bdroning?\b/i, /\bhum\w*\s+fan/i],
    label: 'Electric fan',
    promptFn: () => 'soft steady electric fan hum, gentle white noise, calming ambient drone, ASMR',
    negType: '',
  },
  {
    patterns: [/\blibrary\b/i, /\breading\s+room\b/i, /\bquiet\s+room\b/i],
    label: 'Library ambience',
    promptFn: () => 'soft continuous library ambience, gentle steady background hum of a reading room, muffled distant atmosphere, calming ASMR',
    negType: 'tapping',
  },
  {
    patterns: [/\btrain\b/i, /\brailway\b/i, /\brailroad\b/i, /\btracks\b/i, /\blocomotive\b/i],
    label: 'Train ambience',
    promptFn: () => 'continuous steady train wheels rolling on rails, smooth unbroken rhythmic rumble of train travel, calming ASMR',
    negType: 'tapping',
  },
  {
    patterns: [/\bsinging\s+bowl\b/i, /\btibetan\b/i, /\bmeditation\s+bell\b/i, /\bbowl\s+ring/i],
    label: 'Singing bowl',
    promptFn: () => 'multiple overlapping tibetan singing bowls humming continuously, sustained resonant drone texture, meditative ambient ASMR',
    negType: '',
  },
  {
    patterns: [/\bpaint\w*/i, /\bwatercolor\w*/i, /\bcanvas\b/i, /\beasel\b/i],
    label: 'Brush strokes',
    promptFn: () => 'continuous overlapping soft paintbrush strokes on canvas, steady flowing painting sounds, natural calming ASMR',
    negType: 'tapping',
  },
]

const NON_ASMR: { patterns: RegExp[]; warning: string; fallbackIdx: number }[] = [
  { patterns: [/\bmusic\b/i, /\bsong\b/i, /\bsinging\b/i, /\bmelody\b/i, /\bdrums?\b/i],
    warning: "Music can't be generated as sound effects.", fallbackIdx: 11 },
  { patterns: [/\bexplosion\b/i, /\bbang\b/i, /\bcrash\b/i, /\bboom\b/i],
    warning: 'ASMR needs soft, quiet sounds.', fallbackIdx: 12 },
  { patterns: [/\btalking\b/i, /\bspeaking\b/i, /\bconversation\b/i],
    warning: "Spoken voice isn't supported. Using breathing instead.", fallbackIdx: 19 },
]

// ─── SCENE EXTRACTION ────────────────────────────────────────────────

function extractSceneComponents(raw: string): SoundComponent[] {
  const found: SoundComponent[] = []
  const usedLabels = new Set<string>()

  for (const el of SCENE_ELEMENTS) {
    if (found.length >= 4) break
    if (el.patterns.some(p => p.test(raw)) && !usedLabels.has(el.label)) {
      usedLabels.add(el.label)
      found.push({
        id: Math.random().toString(36).slice(2, 8),
        originalText: el.label,
        enhancedPrompt: `${el.promptFn()}, ${negFor(el.negType)}`,
        displayLabel: el.label,
        status: 'pending', volume: 70,
      })
    }
  }

  for (const bad of NON_ASMR) {
    if (bad.patterns.some(p => p.test(raw))) {
      const fallback = SCENE_ELEMENTS[bad.fallbackIdx]
      if (!usedLabels.has(fallback.label)) {
        usedLabels.add(fallback.label)
        found.push({
          id: Math.random().toString(36).slice(2, 8),
          originalText: raw.trim(),
          enhancedPrompt: `${fallback.promptFn()}, ${negFor(fallback.negType)}`,
          displayLabel: fallback.label,
          status: 'pending', volume: 70,
          warning: bad.warning + ` Generating "${fallback.label}" instead.`,
        })
      }
    }
  }

  return found
}

// ─── AUDIO VALIDATION ────────────────────────────────────────────────

function validateAudio(buffer: AudioBuffer): { valid: boolean; reason?: string } {
  const data = buffer.getChannelData(0)
  const rmsVal = Math.sqrt(data.reduce((s, x) => s + x * x, 0) / data.length)
  if (rmsVal < 0.0005) return { valid: false, reason: 'nearly silent' }
  let silent = 0
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) < 0.001) silent++
  if (silent / data.length > 0.90) return { valid: false, reason: 'too much silence' }
  return { valid: true }
}

function retryPrompt(original: string, attempt: number): string {
  if (attempt === 1) return original + ', sustained continuous ambient texture'
  const core = original.split(',')[0]
  return `${core}, pure ambient sound texture, loopable, ${BASE_NEG}`
}

// ─── AUDIO UTILITIES ─────────────────────────────────────────────────

function makeCrossfadeLoop(ctx: AudioContext, buf: AudioBuffer): AudioBuffer {
  const sr = buf.sampleRate
  const L = buf.length
  const C = Math.min(Math.floor(0.08 * sr), Math.floor(L / 4))
  if (L <= C * 2) return buf
  const out = ctx.createBuffer(buf.numberOfChannels, L - C, sr)
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch)
    const dst = out.getChannelData(ch)
    for (let i = 0; i < C; i++) {
      const t = i / C
      dst[i] = src[i] * Math.sin((t * Math.PI) / 2) + src[L - C + i] * Math.cos((t * Math.PI) / 2)
    }
    for (let i = C; i < L - C; i++) dst[i] = src[i]
  }
  return out
}

function rms(buf: AudioBuffer): number {
  const d = buf.getChannelData(0)
  let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]
  return Math.sqrt(s / d.length)
}

interface FilterNodes {
  warmth: BiquadFilterNode; presence: BiquadFilterNode
  air: BiquadFilterNode; smooth: BiquadFilterNode; master: GainNode
}
interface CompNodes { normalGain: GainNode; userGain: GainNode; source: AudioBufferSourceNode }

const DEFAULT_FILTERS: FilterSettings = { presence: 0, air: 0, warmth: 0, smooth: 100 }
const TARGET_RMS = 0.07

const DURATION_OPTIONS: { label: string; value: number | null }[] = [
  { label: '∞', value: null },
  { label: '5m', value: 300 },
  { label: '15m', value: 900 },
  { label: '30m', value: 1800 },
  { label: '1h', value: 3600 },
]

function formatTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────

export default function ASMRGenerator() {
  const [state, setState] = useState<AppState>({
    phase: 'idle', components: [], filters: DEFAULT_FILTERS, duration: null, lastInput: '',
    mode: 'layer', currentSequenceId: null,
  })

  const ctxRef   = useRef<AudioContext | null>(null)
  const filterRef = useRef<FilterNodes | null>(null)
  const compNodesRef = useRef<Map<string, CompNodes>>(new Map())

  // Sequence player state
  const seqRef = useRef<{
    stopped: boolean
    currentSoundId: string | null
    cleanup: () => void
  }>({ stopped: true, currentSoundId: null, cleanup: () => {} })

  function getCtx(): AudioContext {
    if (!ctxRef.current || ctxRef.current.state === 'closed')
      ctxRef.current = new AudioContext()
    return ctxRef.current
  }

  function buildFilters(audioCtx: AudioContext): FilterNodes {
    const warmth = audioCtx.createBiquadFilter()
    warmth.type = 'lowshelf'; warmth.frequency.value = 200; warmth.gain.value = 0
    const presence = audioCtx.createBiquadFilter()
    presence.type = 'peaking'; presence.frequency.value = 3000; presence.Q.value = 1.5; presence.gain.value = 0
    const air = audioCtx.createBiquadFilter()
    air.type = 'highshelf'; air.frequency.value = 8000; air.gain.value = 0
    const smooth = audioCtx.createBiquadFilter()
    smooth.type = 'lowpass'; smooth.frequency.value = 20000; smooth.Q.value = 0.5
    const master = audioCtx.createGain(); master.gain.value = 0.85
    warmth.connect(presence); presence.connect(air); air.connect(smooth)
    smooth.connect(master); master.connect(audioCtx.destination)
    return { warmth, presence, air, smooth, master }
  }

  function getFilters(): FilterNodes {
    const audioCtx = getCtx()
    if (!filterRef.current) filterRef.current = buildFilters(audioCtx)
    return filterRef.current
  }

  // ─── LAYER MODE: play a single component as a loop ───────────────
  function playComp(id: string, buf: AudioBuffer, volume: number) {
    const audioCtx = getCtx(); const f = getFilters()
    stopComp(id)
    const loopBuf = makeCrossfadeLoop(audioCtx, buf)
    const r = rms(loopBuf)
    const normGain = audioCtx.createGain()
    normGain.gain.value = r > 0 ? Math.min(6, TARGET_RMS / r) : 1
    const userGain = audioCtx.createGain()
    userGain.gain.value = volume / 100
    const src = audioCtx.createBufferSource()
    src.buffer = loopBuf; src.loop = true
    src.connect(normGain); normGain.connect(userGain); userGain.connect(f.warmth)
    src.start(0, Math.random() * loopBuf.duration)
    compNodesRef.current.set(id, { normalGain: normGain, userGain, source: src })
  }

  function stopComp(id: string) {
    const n = compNodesRef.current.get(id); if (!n) return
    try { n.source.stop() } catch {}
    n.source.disconnect(); n.normalGain.disconnect(); n.userGain.disconnect()
    compNodesRef.current.delete(id)
  }

  // ─── SEQUENCE MODE: crossfade chain with rare-sound cycling ──────
  const startSequence = useCallback((comps: SoundComponent[]) => {
    seqRef.current.stopped = true
    seqRef.current.cleanup()

    // Background comps loop independently — exclude from the sequence chain
    const playable = comps.filter(c => c.audioBuffer && c.status === 'ready' && !c.voiceConfig && !c.background)
    if (playable.length === 0) return

    const audioCtx = getCtx()
    const f = getFilters()
    seqRef.current.stopped = false

    const OVERLAP            = 0.9  // seconds of crossfade overlap between clips
    const OCCASIONAL_EVERY   = 4    // play 'occasional' sounds every N cycles
    const SETUP_EVERY        = 12   // play 'setup' sounds every N cycles (after first)

    let cycleCount    = 0   // which full pass we're on (0 = first pass)
    let posInCycle    = 0
    let nextStartTime = audioCtx.currentTime + 0.05

    // Three-tier frequency gate:
    //   continuous → always play
    //   occasional → every OCCASIONAL_EVERY cycles
    //   setup      → only cycle 0, then every SETUP_EVERY cycles
    function shouldPlay(comp: SoundComponent, cycle: number): boolean {
      const f = comp.frequency ?? 'continuous'
      if (f === 'continuous') return true
      if (f === 'occasional') return cycle % OCCASIONAL_EVERY === 0
      if (f === 'setup')      return cycle === 0 || cycle % SETUP_EVERY === 0
      return true
    }

    function getNextComp(): SoundComponent {
      for (let attempts = 0; attempts < playable.length * 2; attempts++) {
        const item = playable[posInCycle]
        const cycleWhenPlaying = cycleCount  // snapshot before potential increment
        posInCycle++
        if (posInCycle >= playable.length) {
          posInCycle = 0
          cycleCount++
        }
        if (shouldPlay(item, cycleWhenPlaying)) return item
      }
      return playable[0] // absolute fallback
    }

    function scheduleStep() {
      if (seqRef.current.stopped) return

      const comp = getNextComp()
      const buf  = comp.audioBuffer!
      const clipDur   = buf.duration
      const overlap   = Math.min(OVERLAP, clipDur * 0.25)
      const fadeInDur = Math.min(0.35, (clipDur - overlap) / 2)

      const startAt = nextStartTime
      const endAt   = startAt + clipDur
      nextStartTime = endAt - overlap   // next clip starts as this one fades out

      // Audio graph: src → fadeGain → normGain → userGain → filter chain
      const fadeGain = audioCtx.createGain()
      const normGain = audioCtx.createGain()
      const userGain = audioCtx.createGain()
      const src = audioCtx.createBufferSource()
      src.buffer = buf
      src.connect(fadeGain); fadeGain.connect(normGain); normGain.connect(userGain); userGain.connect(f.warmth)

      const r = rms(buf)
      normGain.gain.value = r > 0 ? Math.min(6, TARGET_RMS / r) : 1
      userGain.gain.value = comp.volume / 100

      // Envelope: fade in → sustain → fade out (overlaps into next clip)
      fadeGain.gain.setValueAtTime(0, startAt)
      fadeGain.gain.linearRampToValueAtTime(1, startAt + fadeInDur)
      const fadeOutStart = Math.max(startAt + fadeInDur + 0.01, endAt - overlap)
      fadeGain.gain.setValueAtTime(1, fadeOutStart)
      fadeGain.gain.linearRampToValueAtTime(0, endAt)

      src.start(startAt)
      // Let src naturally end; WebAudio will clean it up
      compNodesRef.current.set(comp.id, { normalGain: normGain, userGain, source: src })

      // Update UI when this clip's start time arrives
      const msUntilStart = Math.max(0, (startAt - audioCtx.currentTime) * 1000)
      const uiTimer = setTimeout(() => {
        if (seqRef.current.stopped) return
        seqRef.current.currentSoundId = comp.id
        setState(prev => ({ ...prev, currentSequenceId: comp.id }))
      }, msUntilStart)

      // Schedule the next clip right when the crossfade begins
      const msUntilNext = Math.max(50, (nextStartTime - audioCtx.currentTime) * 1000)
      const nextTimer = setTimeout(scheduleStep, msUntilNext)

      seqRef.current.cleanup = () => {
        clearTimeout(uiTimer)
        clearTimeout(nextTimer)
        try { src.stop() } catch {}
      }
    }

    scheduleStep()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Start sequence when all action sounds are ready and mode=sequence
  useEffect(() => {
    if (state.mode !== 'sequence') return
    if (state.phase !== 'ready') return
    // Only sequence non-background, non-voice comps
    const actionComps = state.components.filter(c => !c.voiceConfig && !c.background)
    const allDone = actionComps.length > 0 && actionComps.every(c => c.status === 'ready' || c.status === 'failed')
    if (!allDone) return
    const readyComps = actionComps.filter(c => c.status === 'ready' && c.audioBuffer)
    if (readyComps.length > 0) startSequence(readyComps)
  }, [state.phase, state.mode, state.components, startSequence])

  function stopAll() {
    // Stop sequence player
    seqRef.current.stopped = true
    seqRef.current.cleanup()
    seqRef.current.currentSoundId = null

    compNodesRef.current.forEach((_, id) => stopComp(id))
    if (filterRef.current) { filterRef.current.master.disconnect(); filterRef.current = null }
    ctxRef.current?.close(); ctxRef.current = null
  }

  async function handleSubmit(raw: string, duration: number | null) {
    if (!raw.trim()) return

    const BASE_NEG_LOCAL = 'no music, no singing, no voice, no speech, no percussion, no sudden loud sounds, no reverb tail, no distortion, isolated ambient texture only'

    let components: SoundComponent[] = []
    let mode: 'layer' | 'sequence' = 'layer'

    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: raw }),
      })

      if (res.ok) {
        const { voice, sounds, ambientDesc, mode: pipelineMode } = await res.json()
        mode = pipelineMode === 'sequence' ? 'sequence' : 'layer'

        let soundComps: SoundComponent[] = (sounds as { label: string; prompt: string; frequency?: string; background?: boolean }[]).map(s => ({
          id: Math.random().toString(36).slice(2, 8),
          originalText: s.label,
          enhancedPrompt: `${s.prompt}, ${BASE_NEG_LOCAL}`,
          displayLabel: s.label,
          status: 'pending' as const,
          volume: 70,
          frequency: (['continuous','occasional','setup'].includes(s.frequency ?? '') ? s.frequency : 'continuous') as 'continuous' | 'occasional' | 'setup',
          background: s.background === true,
        }))

        if (soundComps.length === 0) {
          soundComps = extractSceneComponents(ambientDesc || raw)
        }

        if (voice?.script) {
          const voiceComp: SoundComponent = {
            id: Math.random().toString(36).slice(2, 8),
            originalText: raw,
            enhancedPrompt: voice.script,
            displayLabel: voice.label ?? 'Narrator',
            status: 'pending',
            volume: 80,
            voiceConfig: {
              accent: voice.accent ?? 'american',
              gender: voice.gender ?? 'female',
              delivery: voice.delivery ?? 'whisper',
              script: voice.script,
            },
          }
          components = [voiceComp, ...soundComps].slice(0, 4)
        } else {
          components = soundComps
        }
      }
    } catch (e) {
      console.error('pipeline failed:', e)
    }

    if (components.length === 0) {
      components = extractSceneComponents(raw)
      if (components.length === 0) {
        const t = raw.trim()
        components = [{
          id: Math.random().toString(36).slice(2, 8),
          originalText: t,
          enhancedPrompt: `${t} sounds, soft gentle ASMR texture, quiet and soothing ambient, ${BASE_NEG_LOCAL}`,
          displayLabel: t,
          status: 'pending' as const,
          volume: 70,
        }]
      }
    }

    setState(prev => ({
      ...prev, phase: 'confirming', components, duration,
      lastInput: raw.trim(), mode, currentSequenceId: null,
    }))
  }

  async function handleGenerate(components: SoundComponent[], duration: number | null, mode: 'layer' | 'sequence') {
    stopAll()
    setState(prev => ({
      ...prev, phase: 'generating', duration, mode, currentSequenceId: null,
      components: components.map(c => ({ ...c, status: 'generating', retries: 0 })),
    }))

    const audioCtx = getCtx(); await audioCtx.resume()

    await Promise.all(components.map(async comp => {
      let buf: AudioBuffer | null = null
      let attempts = 0
      const isVoice = !!comp.voiceConfig
      const maxAttempts = isVoice ? 1 : 3

      while (attempts < maxAttempts && !buf) {
        try {
          const prompt = attempts === 0 ? comp.enhancedPrompt : retryPrompt(comp.enhancedPrompt, attempts)
          if (!isVoice && attempts > 0) {
            setState(prev => ({
              ...prev,
              components: prev.components.map(c => c.id === comp.id ? { ...c, retries: attempts } : c),
            }))
          }
          const res = isVoice
            ? await fetch('/api/tts', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  script: comp.voiceConfig!.script,
                  accent: comp.voiceConfig!.accent,
                  gender: comp.voiceConfig!.gender,
                  delivery: comp.voiceConfig!.delivery,
                }),
              })
            : await fetch('/api/generate', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: prompt }),
              })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const resolvedVoiceName = res.headers.get('x-voice-name') ?? undefined
          const decoded = await audioCtx.decodeAudioData(await res.arrayBuffer())
          if (isVoice || validateAudio(decoded).valid || attempts === 2) {
            buf = decoded
            if (isVoice && resolvedVoiceName) {
              setState(prev => ({
                ...prev,
                components: prev.components.map(c =>
                  c.id === comp.id ? { ...c, voiceName: resolvedVoiceName } : c
                ),
              }))
            }
          }
          else attempts++
        } catch { attempts++; if (attempts >= maxAttempts) break }
      }

      setState(prev => {
        if (!buf) {
          const updated = prev.components.map(c =>
            c.id === comp.id ? { ...c, status: 'failed' as ComponentStatus } : c
          )
          return { ...prev, components: updated, phase: updated.every(c => c.status !== 'generating') ? 'ready' : 'generating' }
        }
        const updated = prev.components.map(c =>
          c.id === comp.id ? { ...c, status: 'ready' as ComponentStatus, audioBuffer: buf!, retries: 0 } : c
        )
        // Play immediately as a loop if:
        // - layer mode (all sounds loop)
        // - voice (always loops)
        // - sequence mode background sound (ambient layer under the sequence)
        const readyComp = updated.find(c => c.id === comp.id)
        if (readyComp?.audioBuffer && (mode === 'layer' || isVoice || readyComp.background)) {
          playComp(comp.id, readyComp.audioBuffer, readyComp.volume)
        }
        return { ...prev, components: updated, phase: updated.every(c => c.status !== 'generating') ? 'ready' : 'generating' }
      })
    }))
  }

  function handleVolume(id: string, vol: number) {
    setState(prev => ({ ...prev, components: prev.components.map(c => c.id === id ? { ...c, volume: vol } : c) }))
    const n = compNodesRef.current.get(id)
    if (n && ctxRef.current) n.userGain.gain.setTargetAtTime(vol / 100, ctxRef.current.currentTime, 0.04)
  }

  function handleFilter(key: keyof FilterSettings, val: number) {
    setState(prev => ({ ...prev, filters: { ...prev.filters, [key]: val } }))
    const f = filterRef.current; const audioCtx = ctxRef.current
    if (!f || !audioCtx) return
    const t = audioCtx.currentTime
    if (key === 'presence') f.presence.gain.setTargetAtTime(val, t, 0.06)
    if (key === 'air') f.air.gain.setTargetAtTime(val, t, 0.06)
    if (key === 'warmth') f.warmth.gain.setTargetAtTime(val, t, 0.06)
    if (key === 'smooth') f.smooth.frequency.setTargetAtTime(2000 + (val / 100) * 18000, t, 0.06)
  }

  function handleExpire() {
    const f = filterRef.current; const audioCtx = ctxRef.current
    if (f && audioCtx) {
      const t = audioCtx.currentTime
      f.master.gain.setValueAtTime(f.master.gain.value, t)
      f.master.gain.linearRampToValueAtTime(0, t + 3)
      setTimeout(() => { stopAll(); setState(prev => ({ phase: 'idle', components: [], filters: DEFAULT_FILTERS, duration: null, lastInput: prev.lastInput, mode: 'layer', currentSequenceId: null })) }, 3500)
    } else {
      stopAll(); setState(prev => ({ phase: 'idle', components: [], filters: DEFAULT_FILTERS, duration: null, lastInput: prev.lastInput, mode: 'layer', currentSequenceId: null }))
    }
  }

  function handleReset() {
    stopAll(); setState(prev => ({ phase: 'idle', components: [], filters: DEFAULT_FILTERS, duration: null, lastInput: prev.lastInput, mode: 'layer', currentSequenceId: null }))
  }

  useEffect(() => () => stopAll(), []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unlock = () => {
      if (!ctxRef.current) ctxRef.current = new AudioContext()
      ctxRef.current.resume()
    }
    document.addEventListener('touchstart', unlock, { once: true })
    document.addEventListener('touchend', unlock, { once: true })
    return () => {
      document.removeEventListener('touchstart', unlock)
      document.removeEventListener('touchend', unlock)
    }
  }, [])

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center px-6 py-12">
      <div className="text-center mb-10">
        <p className="text-xs tracking-[0.3em] text-white/30 uppercase mb-2">Hatch · Prototype</p>
        <h1 className="text-3xl font-light tracking-wide mb-1">ASMR Generator</h1>
        <p className="text-sm text-white/40">Describe a scene — AI layers the sounds</p>
      </div>

      <div className="w-full max-w-lg">
        {state.phase === 'idle' && <IdleView onSubmit={handleSubmit} initialInput={state.lastInput} />}
        {state.phase === 'confirming' && (
          <ConfirmView
            components={state.components} duration={state.duration} mode={state.mode}
            onConfirm={() => handleGenerate(state.components, state.duration, state.mode)}
            onEdit={handleReset}
          />
        )}
        {(state.phase === 'generating' || state.phase === 'ready') && (
          <ActiveView
            components={state.components} filters={state.filters} duration={state.duration}
            mode={state.mode} currentSequenceId={state.currentSequenceId}
            onVolume={handleVolume} onFilter={handleFilter} onExpire={handleExpire} onReset={handleReset}
          />
        )}
      </div>

      <p className="mt-12 text-[10px] text-white/10 tracking-wide">
        v0.5 · AI generated · powered by ElevenLabs
      </p>
    </div>
  )
}

// ─── IDLE VIEW ───────────────────────────────────────────────────────

function IdleView({ onSubmit, initialInput = '' }: { onSubmit: (text: string, duration: number | null) => void; initialInput?: string }) {
  const [input, setInput] = useState(initialInput)
  const [duration, setDuration] = useState<number | null>(null)

  const examples = [
    'fireplace crackling with rain outside',
    'watercolor painting on canvas',
    'British woman whispering by a rainy window',
    'walking slowly through dry sand',
    'making a cup of tea',
    'writing in a journal by candlelight',
  ]

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-xs text-white/60">Describe a scene or activity — sounds are extracted automatically</p>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(input, duration) }}}
          placeholder="e.g. fireplace crackling with rain outside"
          rows={3}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="w-full bg-transparent text-sm text-white/80 placeholder-white/45 resize-none outline-none leading-relaxed"
        />
        <div className="flex flex-wrap gap-1.5 mt-1">
          {examples.map(ex => (
            <button key={ex} onClick={() => setInput(ex)}
              className="text-[10px] text-white/40 hover:text-white/60 border border-white/[0.06] hover:border-white/15 rounded-full px-2.5 py-1 transition-all">
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[10px] text-white/40 uppercase tracking-widest">Run time</p>
        <div className="flex gap-2">
          {DURATION_OPTIONS.map(opt => (
            <button key={String(opt.value)} onClick={() => setDuration(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs transition-all border ${
                duration === opt.value
                  ? 'bg-white/10 border-white/25 text-white'
                  : 'border-white/[0.07] text-white/30 hover:text-white/60 hover:border-white/15'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <button onClick={() => onSubmit(input, duration)} disabled={!input.trim()}
        className="w-full py-2.5 rounded-xl text-xs tracking-wide transition-all duration-200 disabled:opacity-20 bg-white/[0.06] hover:bg-white/[0.12] border border-white/10">
        Generate ↗
      </button>
    </div>
  )
}

// ─── CONFIRM VIEW ────────────────────────────────────────────────────

function ConfirmView({
  components, duration, mode, onConfirm, onEdit,
}: { components: SoundComponent[]; duration: number | null; mode: 'layer' | 'sequence'; onConfirm: () => void; onEdit: () => void }) {
  const durationLabel = DURATION_OPTIONS.find(o => o.value === duration)?.label ?? '∞'
  const soundComps = components.filter(c => !c.voiceConfig)
  const voiceComp = components.find(c => c.voiceConfig)
  const isSequence = mode === 'sequence'

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 flex flex-col gap-5">
      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] text-white/30 uppercase tracking-widest">
            {isSequence
              ? `${soundComps.length}-step sequence`
              : `${components.length} sound${components.length !== 1 ? 's' : ''} detected`
            }
          </p>
          <span className="text-[10px] text-white/40">Runtime: {durationLabel}</span>
        </div>

        {/* Voice comp */}
        {voiceComp && (
          <div className="mb-4 pb-4 border-b border-white/[0.06]">
            <div className="flex gap-3">
              <span className="text-white/35 text-xs mt-0.5 flex-shrink-0">♪</span>
              <div className="flex flex-col gap-1">
                <p className="text-sm text-white font-light">
                  {voiceComp.displayLabel}
                  {voiceComp.voiceConfig && (
                    <span className="ml-2 text-[10px] text-white/30 font-normal">
                      · {voiceComp.voiceConfig.accent} {voiceComp.voiceConfig.gender} · {voiceComp.voiceConfig.delivery}
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-white/35 italic leading-relaxed">"{voiceComp.enhancedPrompt}"</p>
              </div>
            </div>
          </div>
        )}

        {/* Sound comps — show arrows between steps in sequence mode */}
        <div className="flex flex-col gap-3">
          {soundComps.map((c, i) => (
            <div key={c.id}>
              <div className="flex gap-3">
                <span className="text-white/35 text-xs mt-0.5 flex-shrink-0">{i + 1}.</span>
                <div className="flex flex-col gap-1">
                  {c.warning && <p className="text-xs text-amber-400/70 leading-relaxed">⚠ {c.warning}</p>}
                  <p className="text-sm text-white font-light">{c.displayLabel}</p>
                  <p className="text-[10px] text-white/35 italic leading-relaxed">"{c.enhancedPrompt}"</p>
                </div>
              </div>
              {isSequence && i < soundComps.length - 1 && (
                <div className="ml-5 mt-2 text-white/20 text-xs">↓</div>
              )}
              {isSequence && i === soundComps.length - 1 && (
                <div className="ml-5 mt-2 text-white/15 text-[10px]">↺ loops</div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl text-xs tracking-wide bg-white text-black hover:bg-white/90 transition-all">
          Generate ↗
        </button>
        <button onClick={onEdit} className="px-4 py-2.5 rounded-xl text-xs text-white/40 hover:text-white/70 border border-white/10 transition-all">
          Edit
        </button>
      </div>
    </div>
  )
}

// ─── ACTIVE VIEW ─────────────────────────────────────────────────────

const COMP_COLORS = ['#9C7A5E','#7EC8E3','#C4A0D4','#D4C87A','#F0A0B8','#A0D4B8']

function ActiveView({
  components, filters, duration, mode, currentSequenceId, onVolume, onFilter, onExpire, onReset,
}: {
  components: SoundComponent[]; filters: FilterSettings; duration: number | null
  mode: 'layer' | 'sequence'; currentSequenceId: string | null
  onVolume: (id: string, v: number) => void; onFilter: (k: keyof FilterSettings, v: number) => void
  onExpire: () => void; onReset: () => void
}) {
  const [showFilters, setShowFilters] = useState(false)
  const [timeLeft, setTimeLeft] = useState<number | null>(duration)
  const [expired, setExpired] = useState(false)
  const allDone = components.every(c => c.status === 'ready' || c.status === 'failed')
  const anyReady = components.some(c => c.status === 'ready')

  const soundComps = components.filter(c => !c.voiceConfig)
  const seqReady = mode === 'sequence' && soundComps.every(c => c.status === 'ready' || c.status === 'failed')
  const currentSeqIdx = soundComps.findIndex(c => c.id === currentSequenceId)

  useEffect(() => {
    if (!duration || !allDone) return
    setTimeLeft(duration)
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 1) { clearInterval(interval); setExpired(true); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [duration, allDone])

  useEffect(() => { if (expired) onExpire() }, [expired]) // eslint-disable-line react-hooks/exhaustive-deps

  const progress = duration && timeLeft !== null ? (1 - timeLeft / duration) : 0

  return (
    <div className="flex flex-col gap-4">
      {duration && timeLeft !== null && allDone && (
        <div className="flex flex-col gap-1.5">
          <div className="relative h-[2px] rounded-full bg-white/[0.06] overflow-hidden">
            <div className="absolute left-0 top-0 h-full bg-white/20 transition-all duration-1000"
              style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-white/40 tabular-nums">
              {expired ? 'Fading out…' : formatTime(timeLeft)} remaining
            </span>
            <span className="text-[10px] text-white/15">{formatTime(duration)} total</span>
          </div>
        </div>
      )}

      {/* Sequence progress indicator */}
      {mode === 'sequence' && seqReady && currentSequenceId && (
        <div className="flex items-center gap-1.5 px-1">
          {soundComps.filter(c => c.status === 'ready').map((c, i) => (
            <div key={c.id} className="flex items-center gap-1.5">
              <div
                className={`h-1 rounded-full transition-all duration-300 ${c.id === currentSequenceId ? 'w-6 bg-white/60' : 'w-2 bg-white/15'}`}
              />
            </div>
          ))}
          <span className="text-[10px] text-white/30 ml-1">
            step {currentSeqIdx + 1} of {soundComps.filter(c => c.status === 'ready').length}
          </span>
        </div>
      )}

      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 flex flex-col gap-5">
        {components.map((comp, i) => {
          const color = COMP_COLORS[i % COMP_COLORS.length]
          const isRetrying = (comp.retries ?? 0) > 0
          const isCurrentSeqStep = mode === 'sequence' && !comp.voiceConfig && !comp.background && comp.id === currentSequenceId
          const isOtherSeqStep = mode === 'sequence' && !comp.voiceConfig && !comp.background && comp.id !== currentSequenceId && comp.status === 'ready'
          const isBgLoop = mode === 'sequence' && comp.background && comp.status === 'ready'

          return (
            <div key={comp.id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isCurrentSeqStep && <span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ background: color }} />}
                  {isOtherSeqStep && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-white/10" />}
                  {isBgLoop && <span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ background: color, opacity: 0.5 }} />}
                  {!comp.voiceConfig && mode === 'layer' && comp.status === 'ready' && <span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ background: color }} />}
                  {comp.voiceConfig && comp.status === 'ready' && <span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ background: color }} />}
                  {comp.status === 'generating' && <span className="w-1.5 h-1.5 rounded-full animate-ping flex-shrink-0 bg-white/25" />}
                  {comp.status === 'failed' && <span className="text-red-400/50 text-xs">⚠</span>}
                  <div className="flex flex-col">
                    <span
                      className="text-sm font-light transition-colors"
                      style={{
                        color: isCurrentSeqStep ? color
                          : isOtherSeqStep ? 'rgba(255,255,255,0.20)'
                          : comp.status === 'ready' ? color
                          : 'rgba(255,255,255,0.35)',
                      }}>
                      {comp.displayLabel}
                    </span>
                    {comp.voiceConfig && comp.voiceName && (
                      <span className="text-[10px] text-white/25">{comp.voiceName}</span>
                    )}
                  </div>
                </div>
                <span className="text-[10px] text-white/35">
                  {comp.status === 'generating' && (isRetrying ? `Retrying (${comp.retries}/2)…` : 'Generating…')}
                  {comp.status === 'failed' && 'Failed'}
                  {isCurrentSeqStep && 'playing'}
                  {isOtherSeqStep && 'queued'}
                  {isBgLoop && 'ambient'}
                </span>
              </div>
              {comp.status === 'ready' && (
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative h-5 flex items-center">
                    <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.08]" />
                    <div className="absolute left-0 h-[3px] rounded-full transition-all duration-75"
                      style={{ width: `${comp.volume}%`, background: color, opacity: isOtherSeqStep ? 0.2 : 0.65 }} />
                    <input type="range" min={0} max={100} value={comp.volume}
                      onChange={e => onVolume(comp.id, Number(e.target.value))}
                      className="absolute inset-0 w-full opacity-0 cursor-pointer" />
                  </div>
                  <span className="text-[10px] text-white/40 w-6 text-right tabular-nums">{comp.volume}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {allDone && anyReady && (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <button onClick={() => setShowFilters(v => !v)}
            className="w-full flex items-center justify-between text-xs text-white/35 hover:text-white/60 transition-colors">
            <span className="uppercase tracking-widest">Sound Shaping</span>
            <span className="text-[10px]">{showFilters ? '▲' : '▼'}</span>
          </button>
          {showFilters && (
            <div className="mt-5 flex flex-col gap-5">
              <EQSlider label="Presence" hint="intimacy / closeness" leftLabel="distant" rightLabel="intimate"
                value={filters.presence} min={-6} max={6} step={0.5} onChange={v => onFilter('presence', v)} centered />
              <EQSlider label="Air" hint="brightness / sparkle" leftLabel="dark" rightLabel="crisp"
                value={filters.air} min={-6} max={6} step={0.5} onChange={v => onFilter('air', v)} centered />
              <EQSlider label="Warmth" hint="fullness / body" leftLabel="thin" rightLabel="warm"
                value={filters.warmth} min={-6} max={6} step={0.5} onChange={v => onFilter('warmth', v)} centered />
              <EQSlider label="Smooth" hint="reduce harshness" leftLabel="muffled" rightLabel="open"
                value={filters.smooth} min={0} max={100} step={5} onChange={v => onFilter('smooth', v)} centered={false} />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button onClick={onReset} className="text-xs text-white/35 hover:text-white/55 transition-colors">
          ← Start over
        </button>
        {!allDone && (
          <span className="text-xs text-white/35 animate-pulse">
            {components.filter(c => c.status === 'generating').length} generating…
          </span>
        )}
      </div>
    </div>
  )
}

// ─── EQ SLIDER ───────────────────────────────────────────────────────

function EQSlider({
  label, hint, leftLabel, rightLabel, value, min, max, step, onChange, centered,
}: {
  label: string; hint: string; leftLabel: string; rightLabel: string
  value: number; min: number; max: number; step: number
  onChange: (v: number) => void; centered: boolean
}) {
  const pct = ((value - min) / (max - min)) * 100
  const midPct = centered ? ((0 - min) / (max - min)) * 100 : 0
  const fillLeft = centered ? (pct < midPct ? pct : midPct) : 0
  const fillWidth = centered ? Math.abs(pct - midPct) : pct
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-white/60">{label}</span>
          <span className="text-[10px] text-white/35">{hint}</span>
        </div>
        <span className="text-[10px] text-white/30 tabular-nums w-12 text-right">
          {centered ? (value > 0 ? `+${value}` : value) + ' dB' : value + '%'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-white/15 w-10 text-right">{leftLabel}</span>
        <div className="flex-1 relative h-5 flex items-center">
          <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.08]" />
          {centered && <div className="absolute h-[3px] w-px bg-white/15" style={{ left: `${midPct}%` }} />}
          <div className="absolute h-[3px] rounded-full bg-white/40"
            style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }} />
          <input type="range" min={min} max={max} step={step} value={value}
            onChange={e => onChange(Number(e.target.value))}
            className="absolute inset-0 w-full opacity-0 cursor-pointer" />
        </div>
        <span className="text-[9px] text-white/15 w-10">{rightLabel}</span>
      </div>
    </div>
  )
}
