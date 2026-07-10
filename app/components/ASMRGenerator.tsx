'use client'

import { useState, useRef, useEffect } from 'react'

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
}

interface FilterSettings {
  presence: number  // -6..+6 dB, peaking 3 kHz
  air: number       // -6..+6 dB, high shelf 8 kHz
  warmth: number    // -6..+6 dB, low shelf 200 Hz
  smooth: number    // 0..100 → lowpass freq 2kHz–20kHz
}

type AppPhase = 'idle' | 'confirming' | 'generating' | 'ready'

interface AppState {
  phase: AppPhase
  components: SoundComponent[]
  filters: FilterSettings
}

// ─── ASMR KNOWLEDGE BASE ─────────────────────────────────────────────

interface ASMREntry {
  keywords: string[]
  label: string
  promptFn: (material: string) => string
}

const ASMR_DB: ASMREntry[] = [
  { keywords: ['tap','tapping','knock','click'],
    label: 'Tapping',
    promptFn: m => `rhythmic tapping sound ${m}, close-up ASMR microphone, isolated, gentle` },
  { keywords: ['crinkle','crinkling','rustle','rustling','scrunch','wrap'],
    label: 'Crinkling',
    promptFn: m => `${m || 'paper'} crinkling and rustling, close-up ASMR, crispy texture` },
  { keywords: ['brush','brushing','stroke','sweep'],
    label: 'Brushing',
    promptFn: m => `soft gentle brushing ${m}, slow ASMR strokes, very quiet` },
  { keywords: ['scratch','scratching','scrape'],
    label: 'Scratching',
    promptFn: m => `light scratching sound ${m}, ASMR microphone close-up, detailed texture` },
  { keywords: ['whisper','whispering'],
    label: 'Soft breathing',
    promptFn: () => `soft gentle breathing and exhaling, ASMR relaxation audio, very quiet intimate` },
  { keywords: ['breath','breathing','exhale','inhale','blow','blowing'],
    label: 'Soft breathing',
    promptFn: () => `soft gentle breathing sounds, calm exhaling, ASMR, very quiet` },
  { keywords: ['rain','rainfall','drizzle','raindrop'],
    label: 'Rain',
    promptFn: m => `soft gentle rainfall ${m}, soothing rain ASMR, smooth water texture` },
  { keywords: ['fire','fireplace','crackling','crackle','campfire'],
    label: 'Crackling fire',
    promptFn: m => `cozy fireplace crackling ${m}, warm fire ASMR, intimate close-up` },
  { keywords: ['water','stream','creek','brook','flowing','drip','dripping'],
    label: 'Flowing water',
    promptFn: m => `gentle water flowing ${m}, soft water sounds, ASMR relaxation` },
  { keywords: ['ocean','waves','beach','sea'],
    label: 'Ocean waves',
    promptFn: () => `soft ocean waves gently lapping, gentle beach ASMR, soothing` },
  { keywords: ['type','typing','keyboard'],
    label: 'Keyboard typing',
    promptFn: m => `gentle keyboard typing sounds ${m}, soft mechanical key clicks, ASMR` },
  { keywords: ['paper','page','pages','book','turning'],
    label: 'Paper',
    promptFn: () => `soft paper sound, gentle page turning, close-up ASMR recording` },
  { keywords: ['write','writing','pen','pencil','marker','drawing'],
    label: 'Writing',
    promptFn: m => `pencil writing on paper ${m}, soft scratching, ASMR close-up` },
  { keywords: ['wind','breeze'],
    label: 'Soft wind',
    promptFn: m => `gentle soft wind ${m}, light breeze ASMR, soothing` },
  { keywords: ['leaves','leaf','foliage'],
    label: 'Rustling leaves',
    promptFn: m => `leaves rustling ${m}, soft nature ASMR, gentle` },
  { keywords: ['glass','crystal','bowl'],
    label: 'Glass tapping',
    promptFn: () => `glass tapping, crystal resonance close-up, ASMR, clear high tones` },
  { keywords: ['sand','gravel','pebble'],
    label: 'Sand / gravel',
    promptFn: () => `sand or gravel moving softly, granular ASMR texture, gentle` },
  { keywords: ['purr','purring','cat'],
    label: 'Purring',
    promptFn: () => `cat purring softly, deep gentle vibration, ASMR, soothing` },
]

const NON_ASMR: { keywords: string[]; warning: string; fallback: string }[] = [
  { keywords: ['music','song','singing','melody','beat','rhythm','guitar','piano','drums','bass'],
    warning: 'Music can\'t be generated as an ASMR sound effect.',
    fallback: 'soft paper crinkling' },
  { keywords: ['explosion','bang','crash','loud','heavy','intense','boom'],
    warning: 'ASMR uses soft, quiet sounds — loud sounds won\'t work here.',
    fallback: 'gentle rain on a window' },
  { keywords: ['talking','speaking','speech','conversation','dialogue'],
    warning: 'Spoken voice isn\'t supported. Using breathing sounds instead.',
    fallback: 'soft breathing and exhaling' },
]

const MATERIALS = ['wood','wooden','glass','metal','plastic','paper','leather','fabric',
                   'stone','ceramic','velvet','silk','cotton','nylon','cardboard']

function extractMaterial(text: string): string {
  const lower = text.toLowerCase()
  const found = MATERIALS.find(m => lower.includes(m))
  return found ? `on ${found}` : ''
}

function analyzePrompt(raw: string): SoundComponent[] {
  const parts = raw
    .split(/\band\b|\bwith\b|\bwhile\b|\bplus\b|\balso\b|,|&|\+/i)
    .map(s => s.trim()).filter(Boolean)

  return parts.map(part => {
    const lower = part.toLowerCase()
    const id = Math.random().toString(36).slice(2, 8)
    const material = extractMaterial(part)

    // Check non-ASMR first
    const nonAsmr = NON_ASMR.find(n => n.keywords.some(kw => lower.includes(kw)))
    if (nonAsmr) {
      const fallbackEntry = ASMR_DB.find(e => e.keywords.some(kw => nonAsmr.fallback.includes(kw))) ?? ASMR_DB[0]
      return {
        id, originalText: part,
        enhancedPrompt: fallbackEntry.promptFn(''),
        displayLabel: fallbackEntry.label,
        status: 'pending' as ComponentStatus,
        volume: 70,
        warning: nonAsmr.warning + ` Generating "${fallbackEntry.label}" instead.`,
      }
    }

    // Match ASMR category
    const entry = ASMR_DB.find(e => e.keywords.some(kw => lower.includes(kw)))
    if (entry) {
      return {
        id, originalText: part,
        enhancedPrompt: entry.promptFn(material),
        displayLabel: entry.label + (material ? ` (${material.replace('on ', '')})` : ''),
        status: 'pending' as ComponentStatus,
        volume: 70,
      }
    }

    // Unknown — try anyway with ASMR framing
    return {
      id, originalText: part,
      enhancedPrompt: `${part.trim()}, close-up ASMR microphone recording, soft and gentle, isolated`,
      displayLabel: part.trim(),
      status: 'pending' as ComponentStatus,
      volume: 70,
    }
  })
}

// ─── AUDIO UTILITIES ─────────────────────────────────────────────────

/** Blend the tail into the head so the buffer loops without a click. */
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

/** RMS of first channel. */
function rms(buf: AudioBuffer): number {
  const d = buf.getChannelData(0)
  let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]
  return Math.sqrt(s / d.length)
}

interface FilterNodes {
  warmth: BiquadFilterNode
  presence: BiquadFilterNode
  air: BiquadFilterNode
  smooth: BiquadFilterNode
  master: GainNode
}

interface CompNodes { normalGain: GainNode; userGain: GainNode; source: AudioBufferSourceNode }

const DEFAULT_FILTERS: FilterSettings = { presence: 0, air: 0, warmth: 0, smooth: 100 }
const TARGET_RMS = 0.07

// ─── MAIN COMPONENT ──────────────────────────────────────────────────

export default function ASMRGenerator() {
  const [state, setState] = useState<AppState>({
    phase: 'idle', components: [], filters: DEFAULT_FILTERS,
  })

  const ctxRef = useRef<AudioContext | null>(null)
  const filterRef = useRef<FilterNodes | null>(null)
  const compNodesRef = useRef<Map<string, CompNodes>>(new Map())

  function ctx(): AudioContext {
    if (!ctxRef.current || ctxRef.current.state === 'closed')
      ctxRef.current = new AudioContext()
    return ctxRef.current
  }

  function buildFilters(audioCtx: AudioContext): FilterNodes {
    const warmth = audioCtx.createBiquadFilter()
    warmth.type = 'lowshelf'; warmth.frequency.value = 200; warmth.gain.value = 0

    const presence = audioCtx.createBiquadFilter()
    presence.type = 'peaking'; presence.frequency.value = 3000
    presence.Q.value = 1.5; presence.gain.value = 0

    const air = audioCtx.createBiquadFilter()
    air.type = 'highshelf'; air.frequency.value = 8000; air.gain.value = 0

    const smooth = audioCtx.createBiquadFilter()
    smooth.type = 'lowpass'; smooth.frequency.value = 20000; smooth.Q.value = 0.5

    const master = audioCtx.createGain(); master.gain.value = 0.85

    warmth.connect(presence); presence.connect(air); air.connect(smooth)
    smooth.connect(master); master.connect(audioCtx.destination)
    return { warmth, presence, air, smooth, master }
  }

  function filters(): FilterNodes {
    const audioCtx = ctx()
    if (!filterRef.current) filterRef.current = buildFilters(audioCtx)
    return filterRef.current
  }

  function playComp(id: string, buf: AudioBuffer, volume: number) {
    const audioCtx = ctx()
    const f = filters()
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
    const n = compNodesRef.current.get(id)
    if (!n) return
    try { n.source.stop() } catch {}
    n.source.disconnect(); n.normalGain.disconnect(); n.userGain.disconnect()
    compNodesRef.current.delete(id)
  }

  function stopAll() {
    compNodesRef.current.forEach((_, id) => stopComp(id))
    if (filterRef.current) { filterRef.current.master.disconnect(); filterRef.current = null }
    ctxRef.current?.close(); ctxRef.current = null
  }

  // ── HANDLERS ──────────────────────────────────────────────────────

  function handleSubmit(raw: string) {
    if (!raw.trim()) return
    const components = analyzePrompt(raw)
    setState(prev => ({ ...prev, phase: 'confirming', components }))
  }

  async function handleGenerate(components: SoundComponent[]) {
    stopAll()
    setState(prev => ({
      ...prev, phase: 'generating',
      components: components.map(c => ({ ...c, status: 'generating' })),
    }))

    const audioCtx = ctx()
    await audioCtx.resume()

    await Promise.all(components.map(async comp => {
      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: comp.enhancedPrompt }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const arr = await res.arrayBuffer()
        const buf = await audioCtx.decodeAudioData(arr)

        setState(prev => {
          const updated = prev.components.map(c =>
            c.id === comp.id ? { ...c, status: 'ready' as ComponentStatus, audioBuffer: buf } : c
          )
          const readyComp = updated.find(c => c.id === comp.id)
          if (readyComp?.audioBuffer) playComp(comp.id, readyComp.audioBuffer, readyComp.volume)
          const allDone = updated.every(c => c.status === 'ready' || c.status === 'failed')
          return { ...prev, components: updated, phase: allDone ? 'ready' : 'generating' }
        })
      } catch {
        setState(prev => {
          const updated = prev.components.map(c =>
            c.id === comp.id ? { ...c, status: 'failed' as ComponentStatus } : c
          )
          const allDone = updated.every(c => c.status === 'ready' || c.status === 'failed')
          return { ...prev, components: updated, phase: allDone ? 'ready' : 'generating' }
        })
      }
    }))
  }

  function handleVolume(id: string, vol: number) {
    setState(prev => ({
      ...prev,
      components: prev.components.map(c => c.id === id ? { ...c, volume: vol } : c),
    }))
    const n = compNodesRef.current.get(id)
    if (n && ctxRef.current)
      n.userGain.gain.setTargetAtTime(vol / 100, ctxRef.current.currentTime, 0.04)
  }

  function handleFilter(key: keyof FilterSettings, val: number) {
    setState(prev => ({ ...prev, filters: { ...prev.filters, [key]: val } }))
    const f = filterRef.current; const audioCtx = ctxRef.current
    if (!f || !audioCtx) return
    const t = audioCtx.currentTime
    if (key === 'presence') f.presence.gain.setTargetAtTime(val, t, 0.06)
    if (key === 'air') f.air.gain.setTargetAtTime(val, t, 0.06)
    if (key === 'warmth') f.warmth.gain.setTargetAtTime(val, t, 0.06)
    if (key === 'smooth') {
      const freq = 2000 + (val / 100) * 18000
      f.smooth.frequency.setTargetAtTime(freq, t, 0.06)
    }
  }

  function handleReset() {
    stopAll()
    setState({ phase: 'idle', components: [], filters: DEFAULT_FILTERS })
  }

  useEffect(() => () => stopAll(), []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center px-6 py-12">
      <div className="text-center mb-10">
        <p className="text-xs tracking-[0.3em] text-white/30 uppercase mb-2">Hatch · Prototype</p>
        <h1 className="text-3xl font-light tracking-wide mb-1">ASMR Generator</h1>
        <p className="text-sm text-white/40">Describe a sound — AI generates and loops it</p>
      </div>

      <div className="w-full max-w-lg">
        {state.phase === 'idle' && <IdleView onSubmit={handleSubmit} />}

        {state.phase === 'confirming' && (
          <ConfirmView
            components={state.components}
            onConfirm={() => handleGenerate(state.components)}
            onEdit={handleReset}
          />
        )}

        {(state.phase === 'generating' || state.phase === 'ready') && (
          <ActiveView
            components={state.components}
            filters={state.filters}
            onVolume={handleVolume}
            onFilter={handleFilter}
            onReset={handleReset}
          />
        )}
      </div>

      <p className="mt-12 text-[10px] text-white/10 tracking-wide">
        v0.2 · AI generated · powered by ElevenLabs
      </p>
    </div>
  )
}

// ─── IDLE VIEW ───────────────────────────────────────────────────────

function IdleView({ onSubmit }: { onSubmit: (t: string) => void }) {
  const [input, setInput] = useState('')
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 flex flex-col gap-4">
      <p className="text-xs text-white/30">Describe one sound, or combine several (e.g. "rain and paper crinkling")</p>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(input) }}}
        placeholder={'e.g. "soft paper crinkling with gentle rain"'}
        rows={3}
        className="w-full bg-transparent text-sm text-white/80 placeholder-white/15 resize-none outline-none leading-relaxed"
      />
      <button
        onClick={() => onSubmit(input)}
        disabled={!input.trim()}
        className="w-full py-2.5 rounded-xl text-xs tracking-wide transition-all duration-200 disabled:opacity-20 bg-white/[0.06] hover:bg-white/[0.12] border border-white/10"
      >
        Analyze & Generate ↗
      </button>
    </div>
  )
}

// ─── CONFIRM VIEW ────────────────────────────────────────────────────

function ConfirmView({
  components, onConfirm, onEdit,
}: { components: SoundComponent[]; onConfirm: () => void; onEdit: () => void }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 flex flex-col gap-5">
      <div>
        <p className="text-[10px] text-white/30 uppercase tracking-widest mb-4">
          {components.length === 1 ? 'Generating 1 sound' : `Generating ${components.length} sounds`}
        </p>
        <div className="flex flex-col gap-4">
          {components.map((c, i) => (
            <div key={c.id} className="flex gap-3">
              <span className="text-white/20 text-xs mt-0.5 flex-shrink-0">{i + 1}.</span>
              <div className="flex flex-col gap-1">
                {c.warning && (
                  <p className="text-xs text-amber-400/70 leading-relaxed">⚠ {c.warning}</p>
                )}
                {!c.warning && (
                  <p className="text-xs text-white/40">"{c.originalText}"</p>
                )}
                <p className="text-sm text-white font-light">→ {c.displayLabel}</p>
                <p className="text-[10px] text-white/20 italic leading-relaxed">
                  Sending: "{c.enhancedPrompt}"
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <button
          onClick={onConfirm}
          className="flex-1 py-2.5 rounded-xl text-xs tracking-wide bg-white text-black hover:bg-white/90 transition-all"
        >
          Generate ↗
        </button>
        <button
          onClick={onEdit}
          className="px-4 py-2.5 rounded-xl text-xs text-white/40 hover:text-white/70 border border-white/10 transition-all"
        >
          Edit
        </button>
      </div>
    </div>
  )
}

// ─── ACTIVE VIEW ─────────────────────────────────────────────────────

const COMP_COLORS = ['#9C7A5E','#7EC8E3','#C4A0D4','#D4C87A','#F0A0B8','#A0D4B8']

function ActiveView({
  components, filters, onVolume, onFilter, onReset,
}: {
  components: SoundComponent[]
  filters: FilterSettings
  onVolume: (id: string, v: number) => void
  onFilter: (k: keyof FilterSettings, v: number) => void
  onReset: () => void
}) {
  const [showFilters, setShowFilters] = useState(false)
  const allDone = components.every(c => c.status === 'ready' || c.status === 'failed')
  const anyReady = components.some(c => c.status === 'ready')

  return (
    <div className="flex flex-col gap-4">
      {/* Component volume rows */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 flex flex-col gap-5">
        {components.map((comp, i) => {
          const color = COMP_COLORS[i % COMP_COLORS.length]
          return (
            <div key={comp.id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {comp.status === 'ready' && (
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block flex-shrink-0" style={{ background: color }} />
                  )}
                  {comp.status === 'generating' && (
                    <span className="w-1.5 h-1.5 rounded-full animate-ping inline-block bg-white/25 flex-shrink-0" />
                  )}
                  {comp.status === 'failed' && (
                    <span className="text-red-400/50 text-xs flex-shrink-0">⚠</span>
                  )}
                  <span className="text-sm font-light transition-colors" style={{ color: comp.status === 'ready' ? color : 'rgba(255,255,255,0.35)' }}>
                    {comp.displayLabel}
                  </span>
                </div>
                <span className="text-[10px] text-white/20">
                  {comp.status === 'generating' && 'Generating…'}
                  {comp.status === 'failed' && 'Failed'}
                </span>
              </div>

              {comp.status === 'ready' && (
                <div className="flex items-center gap-3">
                  {/* Custom slider track */}
                  <div className="flex-1 relative h-5 flex items-center">
                    <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.08]" />
                    <div
                      className="absolute left-0 h-[3px] rounded-full transition-all duration-75"
                      style={{ width: `${comp.volume}%`, background: color, opacity: 0.65 }}
                    />
                    <input
                      type="range" min={0} max={100} value={comp.volume}
                      onChange={e => onVolume(comp.id, Number(e.target.value))}
                      className="absolute inset-0 w-full opacity-0 cursor-pointer"
                    />
                  </div>
                  <span className="text-[10px] text-white/25 w-6 text-right tabular-nums">{comp.volume}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Sound shaping filters */}
      {allDone && anyReady && (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <button
            onClick={() => setShowFilters(v => !v)}
            className="w-full flex items-center justify-between text-xs text-white/35 hover:text-white/60 transition-colors"
          >
            <span className="uppercase tracking-widest">Sound Shaping</span>
            <span className="text-[10px]">{showFilters ? '▲' : '▼'}</span>
          </button>

          {showFilters && (
            <div className="mt-5 flex flex-col gap-5">
              <EQSlider label="Presence" hint="intimacy / closeness" leftLabel="distant" rightLabel="intimate"
                value={filters.presence} min={-6} max={6} step={0.5}
                onChange={v => onFilter('presence', v)} centered />
              <EQSlider label="Air" hint="brightness / sparkle" leftLabel="dark" rightLabel="crisp"
                value={filters.air} min={-6} max={6} step={0.5}
                onChange={v => onFilter('air', v)} centered />
              <EQSlider label="Warmth" hint="fullness / body" leftLabel="thin" rightLabel="warm"
                value={filters.warmth} min={-6} max={6} step={0.5}
                onChange={v => onFilter('warmth', v)} centered />
              <EQSlider label="Smooth" hint="reduce harshness" leftLabel="muffled" rightLabel="open"
                value={filters.smooth} min={0} max={100} step={5}
                onChange={v => onFilter('smooth', v)} centered={false} />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button onClick={onReset} className="text-xs text-white/20 hover:text-white/55 transition-colors">
          ← Start over
        </button>
        {!allDone && (
          <span className="text-xs text-white/20 animate-pulse">
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

  const fillLeft = centered ? (pct < midPct ? pct : midPct)  : 0
  const fillWidth = centered ? Math.abs(pct - midPct) : pct

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-white/60">{label}</span>
          <span className="text-[10px] text-white/20">{hint}</span>
        </div>
        <span className="text-[10px] text-white/30 tabular-nums w-12 text-right">
          {centered ? (value > 0 ? `+${value}` : value) + ' dB' : value + '%'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-white/15 w-10 text-right">{leftLabel}</span>
        <div className="flex-1 relative h-5 flex items-center">
          <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.08]" />
          {centered && (
            <div className="absolute h-[3px] w-px bg-white/15" style={{ left: `${midPct}%` }} />
          )}
          <div
            className="absolute h-[3px] rounded-full bg-white/40"
            style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
          />
          <input
            type="range" min={min} max={max} step={step} value={value}
            onChange={e => onChange(Number(e.target.value))}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
        </div>
        <span className="text-[9px] text-white/15 w-10">{rightLabel}</span>
      </div>
    </div>
  )
}
