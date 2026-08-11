// GET /api/voice-bank-debug
// Shows exactly what the app is reading from the Google Sheet and what it would pick.
// Visit: https://asmrpt2.vercel.app/api/voice-bank-debug

import { NextResponse } from 'next/server'

const VOICE_BANK_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQTSKf4M_nSfSL5ENVzT1ABHNo55arnkHKCvHcPKBS5X9nD5yC1ELLGXhfFZgn42-4yqlpJX6uX_c3t/pub?gid=1540295902&single=true&output=csv'

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

export async function GET() {
  try {
    // 1. Fetch the sheet
    const res = await fetch(VOICE_BANK_CSV_URL, { cache: 'no-store' })
    if (!res.ok) {
      return NextResponse.json({ error: `Sheet fetch failed: HTTP ${res.status}` })
    }

    const csv = await res.text()
    const rawLines = csv.split('\n')

    // 2. Parse every row and report what happens to each
    const rows: object[] = []
    for (const line of rawLines.slice(1)) {
      if (!line.trim()) continue
      const cols = parseCSVLine(line)
      const name     = cols[0]?.trim() ?? ''
      const voiceId  = cols[1]?.trim() ?? ''
      const gender   = cols[2]?.trim().toLowerCase() ?? ''
      const accent   = cols[3]?.trim().toLowerCase() ?? ''
      const delivery = cols[4]?.trim().toLowerCase() ?? ''
      const idValid  = /^[A-Za-z0-9]{15,25}$/.test(voiceId)

      rows.push({
        name,
        voiceId,
        gender,
        accent,
        delivery,
        idLength: voiceId.length,
        idValid,
        willBeUsed: !!(voiceId && gender && accent && delivery && idValid),
      })
    }

    // 3. Build the parsed bank
    const bank: Record<string, Record<string, Record<string, string[]>>> = {}
    for (const row of rows as Array<{name: string; voiceId: string; gender: string; accent: string; delivery: string; willBeUsed: boolean}>) {
      if (!row.willBeUsed) continue
      bank[row.gender] ??= {}
      bank[row.gender][row.accent] ??= {}
      bank[row.gender][row.accent][row.delivery] ??= []
      bank[row.gender][row.accent][row.delivery].push(`${row.name} (${row.voiceId})`)
    }

    // 4. Simulate picks for common combinations
    type PickRow = { gender: string; accent: string; delivery: string; picked: string | null }
    const picks: PickRow[] = []
    const combos = [
      { gender: 'female', accent: 'american', delivery: 'calm' },
      { gender: 'female', accent: 'american', delivery: 'whisper' },
      { gender: 'female', accent: 'british',  delivery: 'calm' },
      { gender: 'female', accent: 'british',  delivery: 'whisper' },
      { gender: 'male',   accent: 'american', delivery: 'calm' },
      { gender: 'male',   accent: 'american', delivery: 'whisper' },
      { gender: 'male',   accent: 'british',  delivery: 'calm' },
      { gender: 'male',   accent: 'british',  delivery: 'whisper' },
      { gender: 'male',   accent: 'australian', delivery: 'calm' },
    ]
    for (const { gender, accent, delivery } of combos) {
      let pool: string[] = bank[gender]?.[accent]?.[delivery] ?? []
      if (pool.length === 0) pool = Object.values(bank[gender]?.[accent] ?? {}).flat()
      if (pool.length === 0) pool = Object.values(bank[gender] ?? {}).flatMap((a: Record<string,string[]>) => a[delivery] ?? [])
      if (pool.length === 0) pool = Object.values(bank[gender] ?? {}).flatMap((a: Record<string,string[]>) => Object.values(a).flat())
      picks.push({ gender, accent, delivery, picked: pool[0] ?? null })
    }

    return NextResponse.json({
      sheetFetchStatus: 'ok',
      totalRows: rawLines.length - 1,
      parsedRows: rows,
      bank,
      simulatedPicks: picks,
      summary: {
        totalVoicesLoaded: rows.filter((r: object) => (r as {willBeUsed: boolean}).willBeUsed).length,
        totalVoicesSkipped: rows.filter((r: object) => !(r as {willBeUsed: boolean}).willBeUsed).length,
      }
    }, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
