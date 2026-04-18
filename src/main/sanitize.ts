import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'

const window = new JSDOM('').window
const purify = DOMPurify(window as any)

purify.setConfig({
  ALLOWED_TAGS: [
    'a', 'b', 'i', 'em', 'strong', 'p', 'br', 'div', 'span',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'blockquote', 'pre', 'code', 'img', 'hr'
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style', 'width', 'height'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
})

export function sanitizeHtml(html: string): string {
  if (!html) return ''
  return purify.sanitize(html) as string
}

export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/\.\./g, '_')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/^\./, '_')
    .slice(0, 255)
}
