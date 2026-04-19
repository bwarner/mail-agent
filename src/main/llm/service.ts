import type { LLMProviderConfig } from '../../shared/types'
import { db } from '../database'

let activeProvider: LLMProviderConfig | null = null

export async function initLLM(): Promise<void> {
  const providers = await db.listLLMProviders()
  const enabled = providers.find((p) => p.enabled)
  if (enabled) activeProvider = enabled
}

export function setActiveProvider(provider: LLMProviderConfig): void {
  activeProvider = provider
}

export function getActiveProvider(): LLMProviderConfig | null {
  return activeProvider
}

export interface LLMRequest {
  system?: string
  prompt: string
  maxTokens?: number
  temperature?: number
}

export interface LLMResponse {
  text: string
  usage?: { input_tokens: number; output_tokens: number }
}

export async function llmInfer(request: LLMRequest): Promise<LLMResponse> {
  if (!activeProvider) throw new Error('No LLM provider configured')

  switch (activeProvider.type) {
    case 'ollama':
      return ollamaInfer(request)
    case 'anthropic':
      return anthropicInfer(request)
    case 'openai':
    case 'custom':
      return openaiInfer(request)
  }
}

async function ollamaInfer(request: LLMRequest): Promise<LLMResponse> {
  const response = await fetch(`${activeProvider!.endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: activeProvider!.model,
      prompt: request.prompt,
      system: request.system,
      stream: false,
      options: {
        num_predict: request.maxTokens ?? activeProvider!.max_tokens,
        temperature: request.temperature ?? activeProvider!.temperature
      }
    })
  })

  if (!response.ok) throw new Error(`Ollama error: ${response.status}`)

  const data = await response.json() as { response: string }
  return { text: data.response }
}

async function anthropicInfer(request: LLMRequest): Promise<LLMResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01'
  }
  if (activeProvider!.api_key_ref) {
    headers['x-api-key'] = activeProvider!.api_key_ref
  }

  const messages = [{ role: 'user' as const, content: request.prompt }]

  const response = await fetch(`${activeProvider!.endpoint}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: activeProvider!.model,
      max_tokens: request.maxTokens ?? activeProvider!.max_tokens,
      temperature: request.temperature ?? activeProvider!.temperature,
      system: request.system,
      messages
    })
  })

  if (!response.ok) throw new Error(`Anthropic error: ${response.status}`)

  const data = await response.json() as {
    content: { type: string; text: string }[]
    usage: { input_tokens: number; output_tokens: number }
  }

  return {
    text: data.content.map((c) => c.text).join(''),
    usage: data.usage
  }
}

async function openaiInfer(request: LLMRequest): Promise<LLMResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (activeProvider!.api_key_ref) {
    headers['Authorization'] = `Bearer ${activeProvider!.api_key_ref}`
  }

  const messages: any[] = []
  if (request.system) messages.push({ role: 'system', content: request.system })
  messages.push({ role: 'user', content: request.prompt })

  const response = await fetch(`${activeProvider!.endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: activeProvider!.model,
      messages,
      max_tokens: request.maxTokens ?? activeProvider!.max_tokens,
      temperature: request.temperature ?? activeProvider!.temperature
    })
  })

  if (!response.ok) throw new Error(`OpenAI error: ${response.status}`)

  const data = await response.json() as {
    choices: { message: { content: string } }[]
    usage?: { prompt_tokens: number; completion_tokens: number }
  }

  return {
    text: data.choices[0]?.message.content ?? '',
    usage: data.usage ? {
      input_tokens: data.usage.prompt_tokens,
      output_tokens: data.usage.completion_tokens
    } : undefined
  }
}
