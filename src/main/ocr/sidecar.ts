import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { createReadStream } from 'fs'
import { createInterface } from 'readline'

export interface OCRResult {
  text: string
  confidence: number
  pages: number
  error?: string
}

const OCR_TIMEOUT_MS = 120_000

export class OCRSidecar {
  private process: ChildProcess | null = null
  private ready = false
  private pending = new Map<string, {
    resolve: (result: OCRResult) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  async start(): Promise<void> {
    if (this.process) return

    const scriptPath = join(__dirname, '../../sidecar/ocr_server.py')

    this.process = spawn('python3', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const rl = createInterface({ input: this.process.stdout! })

    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line)

        if (msg.type === 'init') {
          this.ready = msg.status === 'ready'
          if (!this.ready) {
            console.error('OCR sidecar init failed:', msg.error)
          }
          return
        }

        if (msg.id) {
          const pending = this.pending.get(msg.id)
          if (pending) {
            clearTimeout(pending.timer)
            this.pending.delete(msg.id)
            if (msg.error) {
              pending.reject(new Error(msg.error))
            } else {
              pending.resolve({
                text: msg.text || '',
                confidence: msg.confidence || 0,
                pages: msg.pages || 1
              })
            }
          }
        }
      } catch {}
    })

    this.process.stderr?.on('data', (data) => {
      console.error('[ocr-sidecar]', data.toString())
    })

    this.process.on('exit', (code) => {
      console.log(`OCR sidecar exited with code ${code}`)
      this.process = null
      this.ready = false
      this.rejectAll(new Error('OCR sidecar exited'))
    })

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (this.ready || !this.process) {
          clearInterval(check)
          resolve()
        }
      }, 100)
      setTimeout(() => { clearInterval(check); resolve() }, 10_000)
    })
  }

  async ocr(filePath: string): Promise<OCRResult> {
    if (!this.process || !this.ready) {
      throw new Error('OCR sidecar not running')
    }

    const id = randomUUID()

    return new Promise<OCRResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('OCR timed out'))
      }, OCR_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })

      const request = JSON.stringify({ id, file_path: filePath }) + '\n'
      this.process!.stdin!.write(request)
    })
  }

  isReady(): boolean {
    return this.ready
  }

  async stop(): Promise<void> {
    if (!this.process) return
    this.process.stdin!.write(JSON.stringify({ type: 'shutdown' }) + '\n')
    this.rejectAll(new Error('OCR sidecar shutting down'))
    this.process.kill()
    this.process = null
    this.ready = false
  }

  private rejectAll(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }
}

export const ocrSidecar = new OCRSidecar()
