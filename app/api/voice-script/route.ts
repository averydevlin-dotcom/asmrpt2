import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `You are an ASMR voice script writer. Given a user's scene description that includes a voice request (accent, gender, or whispering), write a short intimate ASMR narration for that scene.

Your script should:
- Be 50-80 words
- Use second-person present tense ("You settle in...", "Feel the warmth...")
- Use ellipses (...) for natural pauses
- Use soft, sensory language
- Match the mood of the scene
- Never use exclamation marks

Also detect from the input:
- accent: "british" | "australian" | "irish" | "american" (default: "american")
- gender: "female" | "male" (default: "female")
- delivery: "whisper" | "soft" (default: "soft" — only use "whisper" if explicitly requested)
- label: short display name like "British whisper" or "Soft male voice"

Respond with ONLY valid JSON, no other text:
{"script": "...", "accent": "...", "gender": "...", "delivery": "...", "label": "..."}`

export async function POST(req: Request) {
  try {
    const { input } = await req.json()
    if (!input?.trim()) return Response.json({ error: 'No input' }, { status: 400 })

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: 'user', content: input.trim() }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const result = JSON.parse(cleaned)

    return Response.json(result)
  } catch (e) {
    console.error('voice-script error:', e)
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
