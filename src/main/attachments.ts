import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { sanitizeFilename } from './sanitize'

let attachmentsDir: string

export function getAttachmentsDir(): string {
  if (!attachmentsDir) {
    attachmentsDir = join(app.getPath('userData'), 'attachments')
    mkdirSync(attachmentsDir, { recursive: true })
  }
  return attachmentsDir
}

export function saveAttachment(content: Buffer, filename: string): {
  sha256: string
  local_path: string
  size_bytes: number
} {
  const sha256 = createHash('sha256').update(content).digest('hex')
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : ''
  const safeName = sanitizeFilename(filename)
  const storedName = `${sha256}${ext}`
  const localPath = join(getAttachmentsDir(), storedName)

  if (!existsSync(localPath)) {
    writeFileSync(localPath, content)
  }

  return {
    sha256,
    local_path: localPath,
    size_bytes: content.length
  }
}

export function getAttachmentPath(sha256: string, ext: string): string {
  return join(getAttachmentsDir(), `${sha256}${ext}`)
}
