const { Transform } = require('stream')
const express = require('express')
const ajv = require('ajv')()
const fs = require('fs-extra')
const util = require('util')
const moment = require('moment')
const pump = util.promisify(require('pump'))
const csvStringify = require('csv-stringify')
const flatten = require('flat')
const mongodb = require('mongodb')
const journals = require('../utils/journals')
const esUtils = require('../utils/es')
const filesUtils = require('../utils/files')
const datasetAPIDocs = require('../../contract/dataset-api-docs')
const permissions = require('../utils/permissions')
const usersUtils = require('../utils/users')
const datasetUtils = require('../utils/dataset')
const findUtils = require('../utils/find')
const asyncWrap = require('../utils/async-wrap')
const extensions = require('../utils/extensions')
const geo = require('../utils/geo')
const tiles = require('../utils/tiles')
const cache = require('../utils/cache')
const config = require('config')
const clone = require('fast-clone')

const datasetSchema = require('../../contract/dataset')
const datasetSchemaNoRequired = Object.assign(datasetSchema)
delete datasetSchemaNoRequired.required
const validate = ajv.compile(datasetSchemaNoRequired)

let router = express.Router()

const acceptedStatuses = ['finalized', 'error']

const operationsClasses = {
  list: ['list'],
  read: ['readDescription', 'readLines', 'getGeoAgg', 'getValuesAgg', 'getMetricAgg', 'downloadOriginalData', 'downloadFullData', 'readJournal', 'readApiDoc'],
  write: ['writeDescription', 'writeData'],
  admin: ['delete', 'getPermissions', 'setPermissions']
}

// Get the list of datasets
router.get('', asyncWrap(async(req, res) => {
  let datasets = req.app.get('db').collection('datasets')
  const query = findUtils.query(req, {
    'filename': 'file.name',
    'concepts': 'schema.x-refersTo',
    'ids': 'id'
  })
  if (req.query.bbox === 'true') {
    query.bbox = {$ne: null}
  }
  const sort = findUtils.sort(req.query.sort)
  const project = findUtils.project(req.query.select)
  const [skip, size] = findUtils.pagination(req.query)
  const mongoQueries = [
    size > 0 ? datasets.find(query).limit(size).skip(skip).sort(sort).project(project).toArray() : Promise.resolve([]),
    datasets.find(query).count()
  ]
  if (req.query.facets) {
    const q = clone(query)
    if (req.query.owner) q.$and.pop()
    mongoQueries.push(datasets.aggregate(findUtils.facetsQuery(req.query.facets, q)).toArray())
  }
  let [results, count, facets] = await Promise.all(mongoQueries)
  results.forEach(r => {
    r.userPermissions = permissions.list(r, operationsClasses, req.user)
    r.public = permissions.isPublic(r, operationsClasses)
    delete r.permissions
    findUtils.setResourceLinks(r, 'dataset')
  })
  facets = findUtils.parseFacets(facets)
  res.json({results, count, facets})
}))

// Middlewares
router.use('/:datasetId', asyncWrap(async(req, res, next) => {
  req.dataset = req.resource = await req.app.get('db').collection('datasets').findOne({
    id: req.params.datasetId
  }, {
    fields: {
      _id: 0
    }
  })
  if (!req.dataset) return res.status(404).send('Dataset not found')
  findUtils.setResourceLinks(req.dataset, 'dataset')
  req.resourceApiDoc = datasetAPIDocs(req.dataset)
  next()
}))

router.use('/:datasetId/permissions', permissions.router('datasets', 'dataset'))

// retrieve a dataset by its id
router.get('/:datasetId', permissions.middleware('readDescription', 'read'), (req, res, next) => {
  req.dataset.userPermissions = permissions.list(req.dataset, operationsClasses, req.user)
  delete req.dataset.permissions
  res.status(200).send(req.dataset)
})

// Update a dataset's metadata
const patchKeys = ['schema', 'description', 'title', 'license', 'origin', 'extensions', 'publications']
router.patch('/:datasetId', permissions.middleware('writeDescription', 'write'), asyncWrap(async(req, res) => {
  const patch = req.body
  if (!acceptedStatuses.includes(req.dataset.status) && (patch.schema || patch.extensions)) return res.status(409).send('Dataset is not in proper state to be updated')
  var valid = validate(patch)
  if (!valid) return res.status(400).send(validate.errors)

  const forbiddenKey = Object.keys(patch).find(key => !patchKeys.includes(key))
  if (forbiddenKey) return res.status(400).send('Only some parts of the dataset can be modified through this route')

  patch.updatedAt = moment().toISOString()
  patch.updatedBy = {id: req.user.id, name: req.user.name}
  if (patch.extensions) patch.schema = await extensions.prepareSchema(req.app.get('db'), patch.schema || req.dataset.schema, patch.extensions)

  // Changed a previously failed dataset, retry everything.
  if (req.dataset.status === 'error') {
    patch.status = 'uploaded'
  }

  if (!patch.publications) {
    const failedPublications = (req.dataset.publications || []).filter(p => p.status === 'error')
    if (failedPublications.length) {
      failedPublications.forEach(p => { p.status = 'waiting' })
      patch.publications = req.dataset.publications
    }
  }

  if (patch.schema) {
    if (JSON.stringify(esUtils.indexDefinition(patch)) !== JSON.stringify(esUtils.indexDefinition(req.dataset))) {
      // Back to schematized state if schema changed in a manner significant for ES indexing
      patch.status = 'schematized'
    } else if (patch.extensions && patch.extensions.find(e => e.forceNext)) {
      // Back to indexed state if schema did not change in significant manner, but one extension is forced
      patch.status = 'indexed'
    }
  }

  await req.app.get('db').collection('datasets').updateOne({id: req.params.datasetId}, {'$set': patch})
  res.status(200).json(patch)
}))

const unlink = util.promisify(fs.unlink)
// Delete a dataset
router.delete('/:datasetId', permissions.middleware('delete', 'admin'), asyncWrap(async(req, res) => {
  const owner = usersUtils.owner(req)

  // TODO : Remove indexes
  await unlink(datasetUtils.fileName(req.dataset))
  if (req.dataset.originalFile) await unlink(datasetUtils.originalFileName(req.dataset))
  await req.app.get('db').collection('datasets').deleteOne({
    id: req.params.datasetId
  })
  await req.app.get('db').collection('journals').deleteOne({
    type: 'dataset',
    id: req.params.datasetId
  })
  await esUtils.delete(req.app.get('es'), req.dataset)
  const storageRemaining = await datasetUtils.storageRemaining(req.app.get('db'), owner, req)
  if (storageRemaining !== -1) res.set(config.headers.storedBytesRemaining, storageRemaining)
  res.sendStatus(204)
}))

const datasetFileSample = require('../utils/dataset-file-sample')
const chardet = require('chardet')
const baseTypes = new Set(['text/csv', 'application/geo+json'])

// Create a dataset by uploading data
router.post('', filesUtils.uploadFile(), asyncWrap(async(req, res) => {
  if (!req.user) return res.status(401).send()
  const owner = usersUtils.owner(req)
  if (!permissions.canDoForOwner(owner, 'postDataset', req.user, req.app.get('db'))) return res.sendStatus(403)
  if (!req.file) return res.sendStatus(400)

  const date = moment().toISOString()
  const dataset = {
    id: req.file.id,
    title: req.file.title,
    owner,
    permissions: [],
    createdBy: {id: req.user.id, name: req.user.name},
    createdAt: date,
    updatedBy: {id: req.user.id, name: req.user.name},
    updatedAt: date
  }

  if (!baseTypes.has(req.file.mimetype)) {
    // we first need to convert the file in a textual format easy to index
    dataset.status = 'uploaded'
    dataset.originalFile = {
      name: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    }
  } else {
    // The format of the original file is already well suited to workers
    dataset.status = 'loaded'
    dataset.file = {
      name: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    }
    const fileSample = await datasetFileSample(dataset)
    dataset.file.encoding = chardet.detect(fileSample)
  }

  // Make sure the creator can work on the resource he just created
  // even if he created it in an organization
  if (owner.type === 'organization') {
    dataset.permissions.push({
      type: 'user',
      id: req.user.id,
      name: req.user.name,
      classes: ['list', 'read', 'write', 'admin']
    })
  }

  await req.app.get('db').collection('datasets').insertOne(dataset)
  const storageRemaining = await datasetUtils.storageRemaining(req.app.get('db'), owner, req)
  if (storageRemaining !== -1) res.set(config.headers.storedBytesRemaining, storageRemaining)
  await journals.log(req.app, dataset, {type: 'dataset-created', href: config.publicUrl + '/dataset/' + dataset.id}, 'dataset')
  res.status(201).send(dataset)
}))

// Update an existing dataset data
router.post('/:datasetId', permissions.middleware('writeData', 'write'), filesUtils.uploadFile(), asyncWrap(async(req, res) => {
  const owner = usersUtils.owner(req)
  if (!acceptedStatuses.includes(req.dataset.status)) return res.status(409).send('Dataset is not in proper state to be updated')
  if (!req.file) return res.sendStatus(400)

  if (!baseTypes.has(req.file.mimetype)) {
    // we first need to convert the file in a textual format easy to index
    req.dataset.status = 'uploaded'
    req.dataset.originalFile = {
      name: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    }
  } else {
    // The format of the original file is already well suited to workers
    req.dataset.status = 'loaded'
    req.dataset.file = {
      name: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    }
    const fileSample = await datasetFileSample(req.dataset)
    req.dataset.file.encoding = chardet.detect(fileSample)
  }

  req.dataset.updatedBy = {id: req.user.id, name: req.user.name}
  req.dataset.updatedAt = moment().toISOString()
  req.dataset.status = 'loaded'
  await req.app.get('db').collection('datasets').replaceOne({
    id: req.params.datasetId
  }, req.dataset)
  const storageRemaining = await datasetUtils.storageRemaining(req.app.get('db'), owner, req)
  if (storageRemaining !== -1) res.set(config.headers.storedBytesRemaining, storageRemaining)
  await journals.log(req.app, req.dataset, {type: 'data-updated'}, 'dataset')
  res.status(200).send(req.dataset)
}))

// Set max-age
// Also compare manage last-modified and if-modified-since headers for cache revalidation
// only send data if the dataset was finalized since then
// prevent running expensive queries while always presenting fresh data
// also set last finalized date into last-modified header
function managePublicCache(req, res) {
  if (!req.dataset.finalizedAt) return
  res.setHeader('Cache-Control', 'public, max-age=' + config.cache.publicMaxAge)
  const finalizedAt = (new Date(req.dataset.finalizedAt)).toUTCString()
  const ifModifiedSince = req.get('If-Modified-Since')
  if (ifModifiedSince && finalizedAt === ifModifiedSince) return true
  res.setHeader('Last-Modified', finalizedAt)
}

// Read/search data for a dataset
router.get('/:datasetId/lines', permissions.middleware('readLines', 'read'), asyncWrap(async(req, res) => {
  if (req.query && req.query.page && req.query.size && req.query.page * req.query.size > 10000) { return res.status(404).send('You can only access the first 10 000 elements.') }

  const db = req.app.get('db')
  if (!req.user && managePublicCache(req, res)) return res.status(304).send()

  // if the output format is geo default is empty select and make sure geoshape is present
  if (['geojson', 'mvt', 'vt', 'pbf'].includes(req.query.format)) {
    req.query.select = (req.query.select ? req.query.select + ',' : '') + '_geoshape'
  }

  // geojson format benefits from bbox info
  let bboxPromise
  if (req.query.format === 'geojson') {
    bboxPromise = esUtils.bboxAgg(req.app.get('es'), req.dataset, {...req.query})
  }

  const vectorTileRequested = ['mvt', 'vt', 'pbf'].includes(req.query.format)
  // Is the tile cached ?
  let cacheHash
  if (vectorTileRequested && !config.cache.disabled) {
    const {hash, value} = await cache.get(db, {
      type: 'tile',
      datasetId: req.dataset.id,
      finalizedAt: req.dataset.finalizedAt,
      query: req.query
    })
    if (value) return res.status(200).send(value.buffer)
    cacheHash = hash
  }

  const esResponse = await esUtils.searchInDataset(req.app.get('es'), req.dataset, req.query)
  if (req.query.format === 'geojson') {
    const geojson = geo.result2geojson(esResponse)
    geojson.bbox = (await bboxPromise).bbox
    return res.status(200).send(geojson)
  }

  if (vectorTileRequested) {
    if (!req.query.xyz) return res.status(400).send('xyz parameter is required for vector tile format.')
    const tile = tiles.geojson2pbf(geo.result2geojson(esResponse), req.query.xyz.split(',').map(Number))
    // 204 = no-content, better than 404
    if (!tile) return res.status(204).send()
    res.type('application/x-protobuf')
    // write in cache without await on purpose for minimal latency, a cache failure must be detected in the logs
    if (!config.cache.disabled) cache.set(db, cacheHash, new mongodb.Binary(tile))
    return res.status(200).send(tile)
  }

  const result = {
    total: esResponse.hits.total,
    results: esResponse.hits.hits.map(hit => flatten(hit._source))
  }
  res.status(200).send(result)
}))

// Special geo aggregation
router.get('/:datasetId/geo_agg', permissions.middleware('getGeoAgg', 'read'), asyncWrap(async(req, res) => {
  if (!req.user && managePublicCache(req, res)) return res.status(304).send()
  const result = await esUtils.geoAgg(req.app.get('es'), req.dataset, req.query)
  res.status(200).send(result)
}))

// Standard aggregation to group items by value and perform an optional metric calculation on each group
router.get('/:datasetId/values_agg', permissions.middleware('getValuesAgg', 'read'), asyncWrap(async(req, res) => {
  if (!req.user && managePublicCache(req, res)) return res.status(304).send()
  const result = await esUtils.valuesAgg(req.app.get('es'), req.dataset, req.query)
  res.status(200).send(result)
}))

// Simple metric aggregation to calculate some value (sum, avg, etc.)
router.get('/:datasetId/metric_agg', permissions.middleware('getMetricAgg', 'read'), asyncWrap(async(req, res) => {
  if (!req.user && managePublicCache(req, res)) return res.status(304).send()
  const result = await esUtils.metricAgg(req.app.get('es'), req.dataset, req.query)
  res.status(200).send(result)
}))

// Download the full dataset in its original form
router.get('/:datasetId/raw', permissions.middleware('downloadOriginalData', 'read'), (req, res, next) => {
  res.download(req.dataset.originalFile ? datasetUtils.originalFileName(req.dataset) : datasetUtils.fileName(req.dataset), (req.dataset.originalFile || req.dataset.file).name)
})

// Download the full dataset with extensions
router.get('/:datasetId/full', permissions.middleware('downloadFullData', 'read'), asyncWrap(async (req, res, next) => {
  res.setHeader('Content-disposition', 'attachment; filename=' + req.dataset.file.name)
  res.setHeader('Content-type', 'text/csv')
  await pump(
    datasetUtils.readStream(req.dataset),
    extensions.extendStream({db: req.app.get('db'), esClient: req.app.get('es'), dataset: req.dataset}),
    new Transform({transform(chunk, encoding, callback) {
      const flatChunk = flatten(chunk)
      callback(null, req.dataset.schema.map(field => flatChunk[field.key]))
    },
    objectMode: true}),
    csvStringify({columns: req.dataset.schema.map(field => field.title || field['x-originalName'] || field.key), header: true}),
    res
  )
}))

router.get('/:datasetId/api-docs.json', permissions.middleware('readApiDoc', 'read'), (req, res) => {
  res.send(req.resourceApiDoc)
})

router.get('/:datasetId/journal', permissions.middleware('readJournal', 'read'), asyncWrap(async(req, res) => {
  const journal = await req.app.get('db').collection('journals').findOne({
    type: 'dataset',
    id: req.params.datasetId
  })
  if (!journal) return res.send([])
  journal.events.reverse()
  res.json(journal.events)
}))

module.exports = router
