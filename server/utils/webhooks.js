const axios = require('axios')
const config = require('config')
const ua = require('universal-analytics')
const events = require('../../shared/events.json')
const debug = require('debug')('webhooks')

exports.trigger = async (db, type, resource, event) => {
  const settings = await db.collection('settings').findOne({ id: resource.owner.id, type: resource.owner.type }) || {}
  settings.webhooks = settings.webhooks || []
  for (let webhook of settings.webhooks) {
    if (webhook.events && webhook.events.length && !webhook.events.includes(`${type}-${event.type}`)) return
    debug(`Trigger webhook for event ${event.type}`, webhook)
    const eventType = events[type][event.type]
    const href = `${config.publicUrl}/api/v1/${type}s/${resource.id}`
    try {
      // Simple HTTP POST (mattermost, etc.)
      if (webhook.target.type === 'http') {
        let text = (resource.title || resource.id) + ' - ' + eventType.text + (event.href ? ' - ' + event.href : '')
        if (event.data) text += '\n\n' + event.data
        await axios.post(webhook.target.params.url, {
          text,
          href,
          event: event.type
        })
      }

      // Google analytics
      if (webhook.target.type === 'ga') {
        const visitor = ua(webhook.target.params.trackingId)
        visitor.set('appName', webhook.target.params.appName)
        visitor.set('appVersion', webhook.target.params.appVersion)

        await new Promise((resolve, reject) => {
          let label = resource.title
          if (event.data) label += '\n\n' + event.data
          visitor.event(type, eventType.text, label, err => {
            if (err) reject(err)
            else resolve()
          })
        })
      }
    } catch (err) {
      console.log('Failure to send Webhook', webhook, err)
    }
  }
}
