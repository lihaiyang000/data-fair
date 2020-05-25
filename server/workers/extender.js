// Index tabular datasets with elasticsearch using available information on dataset schema
const extensionsUtils = require('../utils/extensions')

exports.eventsPrefix = 'extend'

exports.process = async function(app, dataset) {
  const debug = require('debug')(`worker:extender:${dataset.id}`)

  const db = app.get('db')
  const collection = db.collection('datasets')

  // Perform all extensions with remote services.
  debug('extensions', dataset.extensions)
  const extensions = dataset.extensions || []
  for (const extension of extensions) {
    if (!extension.active) continue
    const remoteService = await db.collection('remote-services').findOne({ id: extension.remoteService })
    if (!remoteService) {
      console.error(`Try to apply extension on dataset ${dataset.id} from remote service ${remoteService.id} but remote service ${extension.action} was not found.`)
      continue
    }
    const action = remoteService.actions.find(a => a.id === extension.action)
    if (!action) {
      console.error(`Try to apply extension on dataset ${dataset.id} from remote service ${remoteService.id} but action ${extension.action} was not found.`)
      continue
    }
    debug('apply extension', extension)
    await extensionsUtils.extend(app, dataset, extension, remoteService, action)
    debug('extension ok')
  }

  if (!dataset.isRest) {
    debug('write full version of the file')
    await extensionsUtils.writeFullFile(app, dataset)
  }

  const result = { status: 'extended' }
  Object.assign(dataset, result)
  await collection.updateOne({ id: dataset.id }, { $set: result })
  debug('done')
}
