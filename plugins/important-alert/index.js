// Important Email Alert Plugin
// Desktop notifications for VIP senders and urgent emails

let config = {}

exports.init = function (pluginConfig) {
  config = pluginConfig || {}
}

exports.onMessage = function (ctx) {
  const vipSenders = config.vip_senders || []
  const urgentKeywords = config.urgent_keywords || [
    'urgent', 'asap', 'immediately', 'action required', 'time sensitive'
  ]

  const fromAddress = ctx.message.from_address.toLowerCase()
  const subject = ctx.message.subject.toLowerCase()

  const isVip = vipSenders.some(
    (vip) => fromAddress === vip.toLowerCase()
  )

  const isUrgent = urgentKeywords.some(
    (kw) => subject.includes(kw.toLowerCase())
  )

  if (isVip) {
    ctx.addTag('vip')
    ctx.notify(
      `VIP: ${ctx.message.from_name}`,
      ctx.message.subject
    )
    ctx.log.info(`VIP email from ${ctx.message.from_address}`)
  }

  if (isUrgent) {
    ctx.addTag('urgent')
    if (!isVip) {
      ctx.notify(
        `Urgent: ${ctx.message.from_name}`,
        ctx.message.subject
      )
    }
    ctx.log.info(`Urgent email: ${ctx.message.subject}`)
  }
}
