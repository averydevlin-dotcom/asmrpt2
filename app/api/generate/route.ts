import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { text, duration_seconds = 8 } = await req.json()

  if (!text?.trim()) {
    return NextResponse.json({ error: 'No prompt provided' }, { status: 400 })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })
  }

  const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text.trim(),
      duration_seconds: Math.min(22, Math.max(2, duration_seconds)),
      prompt_influence: 0.3,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    return NextResponse.json({ error: errorText || `HTTP ${response.status}` }, { status: response.status })
  }

  const audioData = await response.arrayBuffer()
  return new NextResponse(audioData, {
    headers: { 'Content-Type': 'audio/mpeg' },
  })
}
