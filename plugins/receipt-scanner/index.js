// Receipt Scanner Plugin
// Detects purchase receipts and extracts structured data

const RECEIPT_KEYWORDS = [
  'order confirmation',
  'purchase receipt',
  'payment received',
  'thank you for your order',
  'order summary',
  'invoice',
  'transaction',
  'your receipt'
]

const VENDOR_PATTERNS = [
  /from\s+([A-Z][A-Za-z0-9\s&.'-]+?)(?:\s+order|\s+receipt|\s*<)/i,
  /([A-Z][A-Za-z0-9\s&.'-]+?)\s+order\s+confirm/i,
  /thank you for (?:your )?(?:order|purchase) (?:from|at|with) ([A-Za-z0-9\s&.'-]+)/i
]

let config = {}

exports.init = function (pluginConfig) {
  config = pluginConfig || {}
}

exports.onMessage = function (ctx) {
  const subject = ctx.message.subject.toLowerCase()
  const body = ctx.message.body_text.toLowerCase()
  const combined = `${subject}\n${body}`

  // Check if this looks like a receipt
  const isReceipt = RECEIPT_KEYWORDS.some(
    (kw) => subject.includes(kw) || body.includes(kw)
  )

  if (!isReceipt) return

  ctx.addTag('receipt')

  // Extract amounts
  const currencySymbol = config.currency_symbol || '$'
  const escapedSymbol = currencySymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const amountPattern = new RegExp(
    `${escapedSymbol}\\s*([\\d,]+\\.?\\d{0,2})`,
    'g'
  )

  const fullText = `${ctx.message.subject}\n${ctx.message.body_text}`
  const amounts = []
  let match

  while ((match = amountPattern.exec(fullText)) !== null) {
    const amount = parseFloat(match[1].replace(/,/g, ''))
    if (!isNaN(amount) && amount > 0) {
      amounts.push(amount)
    }
  }

  if (amounts.length > 0) {
    const total = Math.max(...amounts)
    const minAmount = config.min_amount || 0

    if (total >= minAmount) {
      ctx.setExtractedData('receipt_total', total)
      ctx.setExtractedData('receipt_currency', currencySymbol)
      ctx.setExtractedData('receipt_amounts', amounts)
    }
  }

  // Extract vendor name
  for (const pattern of VENDOR_PATTERNS) {
    const vendorMatch = fullText.match(pattern)
    if (vendorMatch) {
      ctx.setExtractedData('receipt_vendor', vendorMatch[1].trim())
      break
    }
  }

  // Extract order number
  const orderPatterns = [
    /order\s*#?\s*:?\s*([A-Z0-9-]{5,})/i,
    /confirmation\s*#?\s*:?\s*([A-Z0-9-]{5,})/i,
    /transaction\s*(?:id|#)?\s*:?\s*([A-Z0-9-]{5,})/i
  ]

  for (const pattern of orderPatterns) {
    const orderMatch = fullText.match(pattern)
    if (orderMatch) {
      ctx.setExtractedData('order_number', orderMatch[1])
      break
    }
  }

  // Extract date
  const datePatterns = [
    /(?:order|purchase|transaction)\s+date\s*:?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
    /(?:placed|ordered)\s+(?:on\s+)?(\w+\s+\d{1,2},?\s+\d{4})/i
  ]

  for (const pattern of datePatterns) {
    const dateMatch = fullText.match(pattern)
    if (dateMatch) {
      ctx.setExtractedData('order_date', dateMatch[1])
      break
    }
  }

  ctx.log.info(
    `Receipt detected: ${amounts.length} amounts found, total: ${currencySymbol}${Math.max(...amounts, 0)}`
  )
}
