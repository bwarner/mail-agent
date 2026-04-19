export interface EmbeddingProvider {
  name: string
  type: 'ollama' | 'openai' | 'custom'
  endpoint: string
  model: string
  apiKey?: string
  dimensions: number
}

const DEFAULT_PROVIDER: EmbeddingProvider = {
  name: 'Ollama (nomic-embed-text)',
  type: 'ollama',
  endpoint: 'http://localhost:11434',
  model: 'nomic-embed-text',
  dimensions: 768
}

let currentProvider: EmbeddingProvider = DEFAULT_PROVIDER

export function configureEmbeddings(provider: EmbeddingProvider): void {
  currentProvider = provider
}

export function getEmbeddingDimensions(): number {
  return currentProvider.dimensions
}

export async function generateEmbedding(text: string): Promise<Float32Array | null> {
  const truncated = text.slice(0, 8192)

  try {
    switch (currentProvider.type) {
      case 'ollama':
        return await ollamaEmbed(truncated)
      case 'openai':
      case 'custom':
        return await openaiEmbed(truncated)
    }
  } catch (err) {
    console.error('Embedding generation failed:', err)
    return null
  }
}

async function ollamaEmbed(text: string): Promise<Float32Array> {
  const response = await fetch(`${currentProvider.endpoint}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: currentProvider.model,
      input: text
    })
  })

  if (!response.ok) {
    throw new Error(`Ollama embedding error: ${response.status}`)
  }

  const data = await response.json() as { embeddings: number[][] }
  return new Float32Array(data.embeddings[0])
}

async function openaiEmbed(text: string): Promise<Float32Array> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (currentProvider.apiKey) {
    headers['Authorization'] = `Bearer ${currentProvider.apiKey}`
  }

  const response = await fetch(`${currentProvider.endpoint}/v1/embeddings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: currentProvider.model,
      input: text
    })
  })

  if (!response.ok) {
    throw new Error(`OpenAI embedding error: ${response.status}`)
  }

  const data = await response.json() as {
    data: { embedding: number[] }[]
  }

  return new Float32Array(data.data[0].embedding)
}

export function prepareMessageText(message: {
  subject: string
  from_name: string
  from_address: string
  body_text: string
}): string {
  return [
    `From: ${message.from_name} <${message.from_address}>`,
    `Subject: ${message.subject}`,
    '',
    message.body_text
  ].join('\n')
}
