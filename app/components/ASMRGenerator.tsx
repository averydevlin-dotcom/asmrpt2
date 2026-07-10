'use client'

import { useState, useRef, useEffect } from 'react'

const SLOT_COLORS = [
  '#9C7A5E',
  '#7EC8E3',
  '#C4A0D4',
  '#D4C87A',
  '#F0A0B8',
  '#A0D4B8',
]

const SUGGESTIONS = [
  'soft paper crinkling',
  'gentle finger tapping on wood',
  'glass tapping with nails',
  'light brush strokes on paper',
  'soft whispering and breathing',
  'fireplace crackling close up',
]

type SlotStatus = 'idle' | 'generating' | 'ready' | 'error'

interface Slot {
  id: number
  prompt: string
  volume: number
  status: SlotStatus
  audioBuffer?: AudioBuffer
  error?: string
}

export default function ASMRGenerator() {
  const [slots, setSlots] = useState<Slot[]>(
    Array.from({ length: 1 }, (_, i) => ({
      id: i,
      prompt: '',
      volume: 70,
      status: 'idle',
    }))
  )

  const ctxRef = useRef<AudioContext | null>(null)
  const nodesRef = useRef<Map<number, { source: AudioBufferSourceNode; gain: GainNode }>>(new Map())

  function audioCtx(): AudioContext {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext()
    }
    return ctxRef.current
  }

  function playBuffer(id: number, buffer: AudioBuffer, volume: number) {
    const ctx = audioCtx()
    const existing = nodesRef.current.get(id)
    if (existing) {
      try { existing.source.stop() } catch { /* already stopped */ }
      existing.source.disconnect()
      existing.gain.disconnect()
    }
    const gain = ctx.createGain()
    gain.gain.value = volume / 100
    gain.connect(ctx.destination)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(gain)
    source.start(0, Math.random() * buffer.duration)
    nodesRef.current.set(id, { source, gain })
  }

  function stopBuffer(id: number) {
    const existing = nodesRef.current.get(id)
    if (existing) {
      try { existing.source.stop() } catch { /* already stopped */ }
      existing.source.disconnect()
      existing.gain.disconnect()
      nodesRef.current.delete(id)
    }
  }

  async function generate(id: number, prompt: string) {
    if (!prompt.trim()) return
    stopBuffer(id)
    setSlots(prev => prev.map(s =>
      s.id === id ? { ...s, status: 'generating', prompt: prompt.trim(), error: undefined } : s
    ))

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: prompt.trim() }),
      })
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg || `HTTP ${res.status}`)
      }
      const arr = await res.arrayBuffer()
      const ctx = audioCtx()
      await ctx.resume()
      const buffer = await ctx.decodeAudioData(arr)

      setSlots(prev => {
        const current = prev.find(s => s.id === id)
        playBuffer(id, buffer, current?.volume ?? 70)
        return prev.map(s => s.id === id ? { ...s, status: 'ready', audioBuffer: buffer } : s)
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Generation failed'
      setSlots(prev => prev.map(s =>
        s.id === id ? { ...s, status: 'error', error: msg } : s
      ))
    }
  }

  function handleVolume(id: number, vol: number) {
    setSlots(prev => prev.map(s => s.id === id ? { ...s, volume: vol } : s))
    const nodes = nodesRef.current.get(id)
    if (nodes && ctxRef.current) {
      nodes.gain.gain.setTargetAtTime(vol / 100, ctxRef.current.currentTime, 0.04)
    }
  }

  function clearSlot(id: number) {
    stopBuffer(id)
    setSlots(prev => prev.map(s =>
      s.id === id ? { id, prompt: '', volume: 70, status: 'idle' } : s
    ))
  }

  useEffect(() => {
    const nodes = nodesRef.current
    const ctx = ctxRef.current
    return () => {
      nodes.forEach((_, id) => stopBuffer(id))
      ctx?.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeCount = slots.filter(s => s.status === 'ready').length

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center px-6 py-12">
      <div className="text-center mb-12">
        <p className="text-xs tracking-[0.3em] text-white/30 uppercase mb-2">Hatch · Prototype</p>
        <h1 className="text-3xl font-light tracking-wide mb-1">ASMR Generator</h1>
        <p className="text-sm text-white/40">Describe a sound — AI generates and loops it</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full max-w-3xl">
        {slots.map(slot => (
          <SlotCard
            key={slot.id}
            slot={slot}
            color={SLOT_COLORS[slot.id]}
            suggestion={SUGGESTIONS[slot.id]}
            onGenerate={prompt => generate(slot.id, prompt)}
            onVolume={vol => handleVolume(slot.id, vol)}
            onClear={() => clearSlot(slot.id)}
          />
        ))}
      </div>

      <div className="mt-12 text-center">
        {activeCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-white/20 justify-center mb-3">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse" />
            {activeCount} sound{activeCount !== 1 ? 's' : ''} playing
          </div>
        )}
        <p className="text-[10px] text-white/10 tracking-wide">
          v0.1 · AI generated · powered by ElevenLabs
        </p>
      </div>
    </div>
  )
}

function SlotCard({
  slot, color, suggestion, onGenerate, onVolume, onClear,
}: {
  slot: Slot
  color: string
  suggestion: string
  onGenerate: (prompt: string) => void
  onVolume: (vol: number) => void
  onClear: () => void
}) {
  const [input, setInput] = useState('')
  const isActive = slot.status === 'ready'

  useEffect(() => {
    if (slot.status === 'idle' && !slot.prompt) setInput('')
  }, [slot.status, slot.prompt])

  return (
    <div
      className="rounded-2xl border transition-all duration-500 p-4 flex flex-col gap-3 min-h-[120px] justify-center"
      style={{
        background: isActive ? `${color}0A` : 'rgba(255,255,255,0.02)',
        borderColor: isActive ? `${color}50` : 'rgba(255,255,255,0.07)',
        boxShadow: isActive ? `0 0 24px ${color}18` : 'none',
      }}
    >
      {slot.status === 'idle' && (
        <>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onGenerate(input)
              }
            }}
            placeholder={`e.g. "${suggestion}"`}
            rows={2}
            className="w-full bg-transparent text-sm text-white/70 placeholder-white/15 resize-none outline-none leading-relaxed"
          />
          <button
            onClick={() => onGenerate(input)}
            disabled={!input.trim()}
            className="w-full py-2 rounded-xl text-xs tracking-wide transition-all duration-200 disabled:opacity-20 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20"
          >
            Generate ↗
          </button>
        </>
      )}

      {slot.status === 'generating' && (
        <div className="flex flex-col gap-2 py-1">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ background: color }} />
            <span className="text-xs text-white/40">Generating…</span>
          </div>
          <p className="text-xs text-white/20 truncate italic">"{slot.prompt}"</p>
          <p className="text-[10px] text-white/15 mt-1">Takes ~10–20 seconds</p>
        </div>
      )}

      {slot.status === 'ready' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ background: color }} />
              <span className="text-xs truncate" style={{ color }}>{slot.prompt}</span>
            </div>
            <div className="flex gap-0.5 flex-shrink-0">
              <button onClick={() => onGenerate(slot.prompt)} title="Regenerate" className="text-xs text-white/20 hover:text-white/60 px-1.5 py-0.5 rounded transition-colors">↺</button>
              <button onClick={onClear} title="Clear" className="text-xs text-white/20 hover:text-white/60 px-1.5 py-0.5 rounded transition-colors">×</button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={100} value={slot.volume}
              onChange={e => onVolume(Number(e.target.value))}
              className="flex-1"
              style={{ accentColor: color }}
            />
            <span className="text-[10px] text-white/20 w-6 text-right">{slot.volume}</span>
          </div>
        </div>
      )}

      {slot.status === 'error' && (
        <div className="flex flex-col gap-2 py-1">
          <p className="text-xs text-red-400/60 leading-relaxed">{slot.error}</p>
          <div className="flex gap-3">
            <button onClick={() => onGenerate(slot.prompt)} className="text-xs text-white/30 hover:text-white/70 transition-colors">Retry</button>
            <button onClick={onClear} className="text-xs text-white/30 hover:text-white/70 transition-colors">Clear</button>
          </div>
        </div>
      )}
    </div>
  )
}
