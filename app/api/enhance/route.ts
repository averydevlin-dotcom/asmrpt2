import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `You are an ASMR sound scene decomposer for an AI sound generation app powered by ElevenLabs.

Given a user's description, identify 1-4 distinct ambient sounds that together paint that scene or produce that ASMR texture.

For each sound:
- Write a specific ElevenLabs sound generation prompt (15-25 words) describing the physical texture of the sound
- Use words like: soft, gentle, slow, quiet, calming, soothing, natural, subtle
- Give it a short display label (2-4 words)
- NO music, NO voices, NO percussion, NO sudden loud sounds

Respond with ONLY a valid JSON array, no other text:
[{"label": "Rain on window", "prompt": "soft rain pattering gently on window glass, quiet close-up indoor rainfall ASMR texture"}]`

export async function POST(req: Request) {
  try {
    const { input } = await req.json()
    if (!input?.trim()) return Response.json({ error: 'No input' }, { status: 400 })

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: input.trim() }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const components = JSON.parse(text)

    if (!Array.isArray(components)) throw new Error('Invalid response shape')

    return Response.json({ components })
  } catch (e) {
    console.error('enhance error:', e)
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
