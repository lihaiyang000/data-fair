const fs = require('fs-extra')
const path = require('path')
const Combine = require('stream-combiner')
const { Transform } = require('stream')
const iconv = require('iconv-lite')
const config = require('config')
const csv = require('csv-parser')
const JSONStream = require('JSONStream')
const dir = require('node-dir')
const { Writable } = require('stream')
const shuffle = require('shuffle-array')
const csvStringify = require('csv-stringify')
const flatten = require('flat')
const pump = require('util').promisify(require('pump'))
const fieldsSniffer = require('./fields-sniffer')
const geoUtils = require('./geo')
const restDatasetsUtils = require('./rest-datasets')
const vocabulary = require('../../contract/vocabulary')
const limits = require('./limits')

const baseTypes = new Set(['text/csv', 'application/geo+json'])

exports.dir = (dataset) => {
  return path.join(config.dataDir, dataset.owner.type, dataset.owner.id, 'datasets', dataset.id)
}

exports.fileName = (dataset) => {
  return path.join(exports.dir(dataset), dataset.file.name)
}

exports.originalFileName = (dataset) => {
  return path.join(exports.dir(dataset), dataset.originalFile.name)
}

exports.fullFileName = (dataset) => {
  const parsed = path.parse(dataset.originalFile.name)
  return path.join(exports.dir(dataset), `${parsed.name}-full${parsed.ext}`)
}

exports.attachmentsDir = (dataset) => {
  return path.join(exports.dir(dataset), 'attachments')
}

exports.metadataAttachmentsDir = (dataset) => {
  return path.join(exports.dir(dataset), 'metadata-attachments')
}

exports.lsAttachments = async (dataset) => {
  const dirName = exports.attachmentsDir(dataset)
  if (!await fs.pathExists(dirName)) return []
  const files = (await dir.promiseFiles(dirName))
    .map(f => path.relative(dirName, f))
  return files.filter(p => path.basename(p).toLowerCase() !== 'thumbs.db')
}

exports.lsMetadataAttachments = async (dataset) => {
  const dirName = exports.metadataAttachmentsDir(dataset)
  if (!await fs.pathExists(dirName)) return []
  const files = (await dir.promiseFiles(dirName))
    .map(f => path.relative(dirName, f))
  return files
}

exports.lsFiles = async (dataset) => {
  const infos = {}
  if (dataset.file) {
    const filePath = exports.fileName(dataset)
    infos.file = { filePath, size: (await fs.promises.stat(filePath)).size }
  }
  if (dataset.originalFile) {
    const filePath = exports.originalFileName(dataset)
    infos.originalFile = { filePath, size: (await fs.promises.stat(filePath)).size }
  }
  if (dataset.schema.find(f => f['x-refersTo'] === 'http://schema.org/DigitalDocument')) {
    const dirPath = exports.attachmentsDir(dataset)
    const paths = await exports.lsAttachments(dataset)
    const files = []
    for (const p of paths) {
      const filePath = path.join(dirPath, p)
      files.push({ filePath, size: (await fs.promises.stat(filePath)).size })
    }
    infos.extractedFiles = { nb: files.length, files }
  }
  return infos
}

// Read the dataset file and get a stream of line items
exports.readStream = (dataset, raw = false) => {
  if (dataset.isRest) return restDatasetsUtils.readStream(dataset)

  let parser, transformer
  if (dataset.file.mimetype === 'text/csv') {
    // use result from csv-sniffer to configure parser
    parser = csv({
      separator: dataset.file.props.fieldsDelimiter,
      escape: dataset.file.props.escapeChar,
      quote: dataset.file.props.escapeChar || dataset.file.props.quote,
      newline: dataset.file.props.linesDelimiter,
    })
    // reject empty lines (parsing failures from csv-parser)
    transformer = new Transform({
      objectMode: true,
      transform(item, encoding, callback) {
        const hasContent = Object.keys(item).reduce((a, b) => a || ![undefined, '\n', '\r', '\r\n'].includes(item[b]), false)
        item._i = this.i = (this.i || 0) + 1
        if (hasContent) callback(null, item)
        else callback()
      },
    })
  } else if (dataset.file.mimetype === 'application/geo+json') {
    parser = JSONStream.parse('features.*')
    // transform geojson features into raw data items
    transformer = new Transform({
      objectMode: true,
      transform(feature, encoding, callback) {
        const item = { ...feature.properties }
        if (feature.id) item.id = feature.id
        item.geometry = feature.geometry
        item._i = this.i = (this.i || 0) + 1
        callback(null, item)
      },
    })
  } else {
    throw new Error('Dataset type is not supported ' + dataset.file.mimetype)
  }
  return Combine(
    fs.createReadStream(exports.fileName(dataset)),
    iconv.decodeStream(dataset.file.encoding),
    parser,
    transformer,
    // Fix the objects based on fields sniffing
    new Transform({
      objectMode: true,
      transform(chunk, encoding, callback) {
        if (raw) {
          delete chunk._i
          return callback(null, chunk)
        }
        const line = {}
        dataset.schema.forEach(prop => {
          const value = fieldsSniffer.format(chunk[prop['x-originalName']], prop)
          if (value !== null) line[prop.key] = value
        })
        line._i = chunk._i
        callback(null, line)
      },
    }),
  )
}

// Used by extender worker to produce the "full" version of the file
exports.writeFullStreams = (dataset) => {
  const relevantSchema = dataset.schema.filter(f => f.key.startsWith('_ext_') || !f.key.startsWith('_'))
  const writeStream = fs.createWriteStream(exports.fullFileName(dataset))

  // add BOM for excel, cf https://stackoverflow.com/a/17879474
  writeStream.write('\ufeff')

  const transforms = [new Transform({
    transform(chunk, encoding, callback) {
      const flatChunk = flatten(chunk)
      callback(null, relevantSchema.map(field => flatChunk[field.key]))
    },
    objectMode: true,
  })]

  if (dataset.file.mimetype === 'text/csv') {
    transforms.push(csvStringify({ columns: relevantSchema.map(field => field.title || field['x-originalName'] || field.key), header: true }))
  } else if (dataset.file.mimetype === 'application/geo+json') {
    transforms.push(JSONStream.stringify(`{
  "type": "FeatureCollection",
  "features": [
`, `,
  `, `
]}`))
  } else {
    throw new Error('Dataset type is not supported ' + dataset.file.mimetype)
  }
  return [
    ...transforms,
    writeStream,
  ]
}

exports.sample = async (dataset) => {
  let currentLine = 0
  const linesNumber = [...Array(dataset.file.props.numLines).keys()]
  shuffle(linesNumber)
  const sampleLineNumbers = new Set(linesNumber.slice(0, Math.min(dataset.file.props.numLines, 4000)))
  const sample = []
  await pump(exports.readStream(dataset, true), new Writable({
    objectMode: true,
    write(chunk, encoding, callback) {
      if (sampleLineNumbers.has(currentLine)) sample.push(chunk)
      currentLine += 1
      callback()
    },
  }))
  return sample
}

exports.countLines = async (dataset) => {
  let nbLines = 0
  await pump(exports.readStream(dataset, true), new Writable({
    objectMode: true,
    write(chunk, encoding, callback) {
      nbLines += 1
      callback()
    },
  }))
  return nbLines
}

exports.storage = async (db, dataset) => {
  const storage = {
    size: 0,
  }
  if (dataset.originalFile && dataset.originalFile.size) {
    storage.size += dataset.originalFile.size
    storage.fileSize = dataset.originalFile.size
  } else if (dataset.file && dataset.file.size) {
    storage.size += dataset.file.size
    storage.fileSize = dataset.file.size
  }
  const attachments = await exports.lsAttachments(dataset)
  for (const attachment of attachments) {
    const attachmentSize = (await fs.promises.stat(path.join(exports.attachmentsDir(dataset), attachment))).size
    storage.size += attachmentSize
    storage.attachmentsSize = (storage.attachmentsSize || 0) + attachmentSize
  }
  const metaAttachments = await exports.lsMetadataAttachments(dataset)
  for (const attachment of metaAttachments) {
    const attachmentSize = (await fs.promises.stat(path.join(exports.metadataAttachmentsDir(dataset), attachment))).size
    storage.size += attachmentSize
    storage.attachmentsSize = (storage.attachmentsSize || 0) + attachmentSize
  }
  if (dataset.isRest) {
    const collection = await restDatasetsUtils.collection(db, dataset)
    const stats = await collection.stats()
    storage.size += stats.size
    storage.collectionSize = stats.size
    if (dataset.rest && dataset.rest.history) {
      const revisionsCollection = await restDatasetsUtils.revisionsCollection(db, dataset)
      const revisionsStats = await revisionsCollection.stats()
      storage.size += revisionsStats.size
      storage.revisionsSize = revisionsStats.size
    }
  }
  return storage
}

exports.totalStorage = async (db, owner) => {
  const aggQuery = [
    { $match: { 'owner.type': owner.type, 'owner.id': owner.id } },
    { $project: { 'storage.size': 1 } },
    { $group: { _id: null, totalSize: { $sum: '$storage.size' } } },
  ]
  const res = await db.collection('datasets').aggregate(aggQuery).toArray()
  return (res[0] && res[0].totalSize) || 0
}

// After a change that might impact consumed storage, we store the value
// and trigger optional webhooks
exports.updateStorage = async (db, dataset, deleted = false) => {
  if (!deleted) await db.collection('datasets').updateOne({ id: dataset.id }, { $set: { storage: await exports.storage(db, dataset) } })
  await limits.setConsumption(db, dataset.owner, 'store_bytes', await exports.totalStorage(db, dataset.owner))
}

exports.remainingStorage = async (db, owner) => {
  const limits = await db.collection('limits')
    .findOne({ type: owner.type, id: owner.id })
  const limit = (limits && limits.store_bytes && ![undefined, null].includes(limits.store_bytes.limit)) ? limits.store_bytes.limit : config.defaultLimits.totalStorage
  if (limit === -1) return -1
  const consumption = (limits && limits.store_bytes && limits.store_bytes.consumption) || 0
  return Math.max(0, limit - consumption)
}

exports.extendedSchema = (dataset) => {
  dataset.schema = dataset.schema || []
  const schema = dataset.schema.filter(f => f.key.startsWith('_ext_') || !f.key.startsWith('_'))

  const fileSchema = dataset.file && dataset.file.schema
  schema.forEach(f => {
    // restore original type and format, in case of removal of a concept
    const fileField = fileSchema && fileSchema.find(ff => ff.key === f.key)
    if (fileField) {
      f.type = fileField.type
      f.format = fileField.format
    }

    // apply type from concepts to the actual field (for example SIRET might be parsed a interger, but should be returned a string)
    if (f['x-refersTo']) {
      const concept = vocabulary.find(c => c.identifiers.includes(f['x-refersTo']))
      // forcing other types than string is more dangerous, for now lets do just that
      if (concept && concept.type === 'string') {
        f.type = concept.type
        if (concept.format) f.format = concept.format
      }
    }
  })

  if (dataset.schema.find(f => f['x-refersTo'] === 'http://schema.org/DigitalDocument')) {
    schema.push({ 'x-calculated': true, key: '_file.content', type: 'string', title: 'Contenu textuel du fichier', description: 'Résultat d\'une extraction automatique' })
    schema.push({ 'x-calculated': true, key: '_file.content_type', type: 'string', title: 'Type mime du fichier', description: 'Résultat d\'une détection automatique.' })
    schema.push({ 'x-calculated': true, key: '_file.content_length', type: 'integer', title: 'La taille en octet du fichier', description: 'Résultat d\'une détection automatique.' })
    if (dataset.attachmentsAsImage) {
      schema.push({ 'x-calculated': true, key: '_attachment_url', type: 'string', title: 'URL de téléchargement unitaire de l\'image jointe', 'x-refersTo': 'http://schema.org/image' })
    } else {
      schema.push({ 'x-calculated': true, key: '_attachment_url', type: 'string', title: 'URL de téléchargement unitaire du fichier joint' })
    }
  }
  if (geoUtils.schemaHasGeopoint(dataset.schema) || geoUtils.schemaHasGeometry(dataset.schema)) {
    schema.push({ 'x-calculated': true, key: '_geoshape', type: 'object', title: 'Géométrie', description: 'Au format d\'une géométrie GeoJSON' })
    schema.push({ 'x-calculated': true, key: '_geopoint', type: 'string', title: 'Coordonnée géographique', description: 'Centroïde au format "lat,lon"' })
    schema.push({ 'x-calculated': true, key: '_geocorners', type: 'array', title: 'Boite englobante de la géométrie', description: 'Sous forme d\'un tableau de coordonnées au format "lat,lon"' })
  }
  if (dataset.isRest) {
    schema.push({ 'x-calculated': true, key: '_updatedAt', type: 'string', format: 'date-time', title: 'Date de mise à jour', description: 'Date de dernière mise à jour de la ligne du jeu de données' })
    // schema.push({ 'x-calculated': true, key: '_updatedBy', type: 'object', title: 'Utilisateur de mise à jour', description: 'Utilisateur qui a effectué la e dernière mise à jour de la ligne du jeu de données' })
  }
  schema.push({ 'x-calculated': true, key: '_id', type: 'string', format: 'uri-reference', title: 'Identifiant', description: 'Identifiant unique parmi toutes les lignes du jeu de données' })
  schema.push({ 'x-calculated': true, key: '_i', type: 'integer', title: 'Numéro de ligne', description: 'Indice de la ligne dans le fichier d\'origine' })
  schema.push({ 'x-calculated': true, key: '_rand', type: 'integer', title: 'Nombre aléatoire', description: 'Un nombre aléatoire associé à la ligne qui permet d\'obtenir un tri aléatoire par exemple' })

  return schema
}

exports.reindex = async (db, dataset) => {
  const patch = { status: 'loaded' }
  if (dataset.isVirtual) patch.status = 'indexed'
  else if (dataset.isRest) patch.status = 'schematized'
  else if (dataset.originalFile && !baseTypes.has(dataset.originalFile.mimetype)) patch.status = 'uploaded'
  await db.collection('datasets').updateOne({ id: dataset.id }, { $set: patch })
  return (await db.collection('datasets')
    .findOneAndUpdate({ id: dataset.id }, { $set: patch }, { returnOriginal: false })).value
}

// Generate ids and try insertion until there is no conflict on id
exports.insertWithBaseId = async (db, dataset, baseId) => {
  dataset.id = baseId
  let insertOk = false
  let i = 1
  while (!insertOk) {
    try {
      await db.collection('datasets').insertOne(dataset)
      insertOk = true
    } catch (err) {
      if (err.code !== 11000) throw err
      i += 1
      dataset.id = `${baseId}-${i}`
    }
  }
}
