import { NextRequest, NextResponse } from 'next/server'

// ─── LIVE VOICE BANK (Google Sheets CSV) ─────────────────────────────
// Edit voices at: https://docs.google.com/spreadsheets/d/e/2PACX-1vQTSKf4M_nSfSL5ENVzT1ABHNo55arnkHKCvHcPKBS5X9nD5yC1ELLGXhfFZgn42-4yqlpJX6uX_c3t/pub?gid=1540295902&single=true&output=csv
// Changes take effect within 5 minutes — no code push needed.

const VOICE_BANK_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQTSKf4M_nSfSL5ENVzT1ABHNo55arnkHKCvHcPKBS5X9nD5yC1ELLGXhfFZgn42-4yqlpJX6uX_c3t/pub?gid=1540295902&single=true&output=csv'

interface VoiceEntry { id: string; name: string }
// bank[gender][accent][delivery] → VoiceEntry[]
type VoiceBank = Record<string, Record<string, Record<string, VoiceEntry[]>>>

// Hardcoded fallback used only if the CSV fetch fails entirely
const FALLBACK_BANK: VoiceBank = {
  female: { american: { calm: [{ id: 'GP1bgf0sjoFuuHkyrg8E', name: 'Shannon' }], whisper: [{ id: 'geVuXdUpU0lgUukWJCUE', name: 'Shannon ASMR' }] } },
  male:   { american: { calm: [{ id: 'enzbGixeo55iqn1QxbbC', name: 'Jon' }],     whisper: [{ id: 'RO2BvjCY3XHTRsIYByXn', name: 'Sable' }] } },
}

// 5-minute in-memory cache — refreshes automatically on the next request after expiry
let bankCache: { data: VoiceBank; expiresAt: number } | null = null

function parseCSVLine(line: string): string[] {
  const cols: string[] = []
  let cur = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { cols.push(cur); cur = '' }
    else { cur += ch }
  }
  cols.push(cur)
  return cols
}

function parseVoiceBank(csv: string): VoiceBank {
  const bank: VoiceBank = {}
  const lines = csv.split('\n').slice(1)  // skip header row
  for (const line of lines) {
    const cols = parseCSVLine(line)
    const name     = cols[0]?.trim() ?? ''
    const voiceId  = cols[1]?.trim() ?? ''
    const gender   = cols[2]?.trim().toLowerCase() ?? ''
    const accent   = cols[3]?.trim().toLowerCase() ?? ''
    const delivery = cols[4]?.trim().toLowerCase() ?? ''
    if (!voiceId || !gender || !accent || !delivery) continue
    // Stop at the instruction rows (no valid voice ID)
    if (!voiceId.match(/^[A-Za-z0-9]{15,25}$/)) continue
    bank[gender] ??= {}
    bank[gender][accent] ??= {}
    bank[gender][accent][delivery] ??= []
    bank[gender][accent][delivery].push({ id: voiceId, name })
  }
  return bank
}

async function loadVoiceBank(): Promise<VoiceBank> {
  if (bankCache && Date.now() < bankCache.expiresAt) return bankCache.data
  try {
    const res = await fetch(VOICE_BANK_CSV_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error(`CSV ${res.status}`)
    const bank = parseVoiceBank(await res.text())
    bankCache = { data: bank, expiresAt: Date.now() + 5 * 60 * 1000 }
    console.log('[tts] voice bank refreshed from Google Sheets')
    return bank
  } catch (e) {
    console.error('[tts] voice bank fetch failed, using fallback:', e)
    return FALLBACK_BANK
  }
}

async function pickFromBank(gender: string, accent: string, delivery: string): Promise<string> {
  const bank = await loadVoiceBank()

  // Try exact match: gender + accent + delivery
  let pool = bank[gender]?.[accent]?.[delivery] ?? []

  // Fall back: same gender + accent, ignore delivery
  if (pool.length === 0) {
    pool = Object.values(bank[gender]?.[accent] ?? {}).flat()
  }

  // Fall back: same gender + american + delivery
  if (pool.length === 0) {
    pool = bank[gender]?.['american']?.[delivery] ?? []
  }

  // Fall back: same gender + american, any delivery
  if (pool.length === 0) {
    pool = Object.values(bank[gender]?.['american'] ?? {}).flat()
  }

  // Last resort: female american calm
  if (pool.length === 0) {
    pool = Object.values(bank['female']?.['american'] ?? {}).flat()
  }

  if (pool.length === 0) return 'GP1bgf0sjoFuuHkyrg8E'  // Shannon fallback

  const entry = pool[Math.floor(Math.random() * pool.length)]
  console.log(`[tts] picked: ${entry.name} (${entry.id}) [${gender}/${accent}/${delivery}]`)
  return entry.id
}

// ─── HANDLER ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const {
      script,
      accent   = 'american',
      gender   = 'female',
      delivery = 'calm',
      voiceId: voiceIdOverride,   // optional: audition page passes a specific ID
    } = await req.json()

    if (!script?.trim()) return NextResponse.json({ error: 'No script' }, { status: 400 })

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })

    // Audition mode: caller passed a specific voice ID to test
    // Normal mode: pick randomly from the live Google Sheets voice bank
    const voiceId = voiceIdOverride ?? await pickFromBank(gender, accent, delivery)
    console.log(`[tts] using voiceId=${voiceId}${voiceIdOverride ? ' (override)' : ''}`)

    // whisper: very low stability → airy, breathy, intimate
    // calm:    moderate stability → gentle, clear, soothing speaking voice (default)
    const isWhisper = delivery === 'whisper'
    const stability = isWhisper ? 0.07 : 0.45
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
