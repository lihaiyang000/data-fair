const { Writable } = require('stream')
const express = require('express')
const ajv = require('ajv')()
const util = require('util')
const path = require('path')
const fs = require('fs-extra')
const moment = require('moment')
const createError = require('http-errors')
const pump = util.promisify(require('pump'))
const mongodb = require('mongodb')
const config = require('config')
const chardet = require('chardet')
const slug = require('slugify')
const sanitizeHtml = require('sanitize-html')
const journals = require('../utils/journals')
const esUtils = require('../utils/es')
const filesUtils = require('../utils/files')
const datasetAPIDocs = require('../../contract/dataset-api-docs')
const permissions = require('../utils/permissions')
const usersUtils = require('../utils/users')
const datasetUtils = require('../utils/dataset')
const virtualDatasetsUtils = require('../utils/virtual-datasets')
const restDatasetsUtils = require('../utils/rest-datasets')
const visibilityUtils = require('../utils/visibility')
const findUtils = require('../utils/find')
const asyncWrap = require('../utils/async-wrap')
const extensions = require('../utils/extensions')
const attachments = require('../utils/attachments')
const geo = require('../utils/geo')
const tiles = require('../utils/tiles')
const cache = require('../utils/cache')
const cacheHeaders = require('../utils/cache-headers')
const webhooks = require('../utils/webhooks')
const outputs = require('../utils/outputs')
const datasetPatchSchema = require('../../contract/dataset-patch')
const validatePatch = ajv.compile(datasetPatchSchema)
const datasetPostSchema = require('../../contract/dataset-post')
const validatePost = ajv.compile(datasetPostSchema)
const debugFiles = require('debug')('files')
const router = express.Router()

const datasetFileSample = require('../utils/dataset-file-sample')
const baseTypes = new Set(['text/csv', 'application/geo+json'])

function clean(dataset) {
  dataset.public = permissions.isPublic('datasets', dataset)
  dataset.visibility = visibilityUtils.visibility(dataset)
  delete dataset.permissions
  dataset.description = dataset.description ? sanitizeHtml(dataset.description) : ''
  dataset.previews = datasetUtils.previews(dataset)
  findUtils.setResourceLinks(dataset, 'dataset')
  return dataset
}

const checkStorage = (overwrite) => asyncWrap(async (req, res, next) => {
  if (process.env.NO_STORAGE_CHECK === 'true') return next()
  if (!req.get('Content-Length')) throw createError(411, 'Content-Length is mandatory')
  const contentLength = Number(req.get('Content-Length'))
  if (Number.isNaN(contentLength)) throw createError(400, 'Content-Length is not a number')
  const estimatedContentSize = contentLength - 210

  const owner = req.dataset ? req.dataset.owner : usersUtils.owner(req)
  const datasetLimit = config.defaultLimits.datasetStorage
  if (datasetLimit !== -1 && datasetLimit < estimatedContentSize) throw createError(413, 'Dataset size exceeds the authorized limit')
  let remainingStorage = await datasetUtils.remainingStorage(req.app.get('db'), owner)
  if (remainingStorage !== -1) {
    if (overwrite && req.dataset && req.dataset.storage) {
      // ignore the size of the dataset we are overwriting
      remainingStorage += req.dataset.storage.size
    }
    if ((remainingStorage - estimatedContentSize) <= 0) {
      try {
        await pump(
          req,
          new Writable({
            write(chunk, encoding, callback) {
            // do nothing wa just want to drain the request
              callback()
            },
          }),
        )
      } catch (err) {
        console.error('Failure to drain request that was rejected for exceeding storage limit', err)
      }
      throw createError(429, 'Vous avez atteint la limite de votre espace de stockage.')
    }
  }
  next()
})

// check if the endpoint is called from an application with an aunauthenticated readOnly application key
const applicationKey = asyncWrap(async (req, res, next) => {
  const referer = req.headers.referer || req.headers.referrer
  if (referer) {
    const refererUrl = new URL(referer)
    const key = refererUrl && refererUrl.searchParams && refererUrl.searchParams.get('key')
    if (key) {
      const applicationKeys = await req.app.get('db').collection('applications-keys').findOne({ 'keys.id': key })
      if (applicationKeys) {
        const filter = {
          id: applicationKeys._id,
          'owner.type': req.dataset.owner.type,
          'owner.id': req.dataset.owner.id,
          'configuration.datasets.href': `${config.publicUrl}/api/v1/datasets/${req.dataset.id}`,
        }
        const matchingApplication = await req.app.get('db').collection('applications').count(filter)
        if (matchingApplication) req.bypassPermission = true
      }
    }
  }
  next()
})

// Get the list of datasets
router.get('', cacheHeaders.noCache, asyncWrap(async(req, res) => {
  const datasets = req.app.get('db').collection('datasets')
  const filterFields = {
    concepts: 'schema.x-refersTo',
    'field-type': 'schema.type',
    'field-format': 'schema.format',
    children: 'virtual.children',
    services: 'extensions.remoteService',
    status: 'status',
    topics: 'topics.id',
  }
  const facetFields = {
    ...filterFields,
    topics: 'topics',
  }
  const query = findUtils.query(req, Object.assign({
    filename: 'originalFile.name',
    ids: 'id',
    id: 'id',
    rest: 'isRest',
  }, filterFields))
  if (req.query.bbox === 'true') {
    query.bbox = { $ne: null }
  }
  const sort = findUtils.sort(req.query.sort)
  const project = findUtils.project(req.query.select)
  const [skip, size] = findUtils.pagination(req.query)
  const mongoQueries = [
    size > 0 ? datasets.find(query).limit(size).skip(skip).sort(sort).project(project).toArray() : Promise.resolve([]),
    datasets.countDocuments(query),
  ]
  if (req.query.facets) {
    mongoQueries.push(datasets.aggregate(findUtils.facetsQuery(req, facetFields)).toArray())
  }
  let [results, count, facets] = await Promise.all(mongoQueries)
  results.forEach(r => {
    r.userPermissions = permissions.list('datasets', r, req.user)
    clean(r)
  })
  facets = findUtils.parseFacets(facets)
  res.json({ count, results, facets })
}))

// Shared middleware to read dataset in db
// also checks that the dataset is in a state compatible with some action
// supports waiting a little bit to be a little permissive with the user
const readDataset = (acceptedStatuses) => asyncWrap(async(req, res, next) => {
  for (let i = 0; i < 10; i++) {
    req.dataset = req.resource = await req.app.get('db').collection('datasets')
      .findOne({ id: req.params.datasetId }, { projection: { _id: 0 } })
    if (!req.dataset) return res.status(404).send('Dataset not found')
    req.resourceType = 'datasets'
    req.resourceApiDoc = datasetAPIDocs(req.dataset)

    if (req.isNewDataset || !acceptedStatuses || acceptedStatuses.includes(req.dataset.status)) return next()

    // dataset found but not in proper state.. wait a little while
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw createError(409, `Le jeu de données n'est pas dans un état permettant l'opération demandée. État courant : ${req.dataset.status}.`)
})

router.use('/:datasetId/permissions', readDataset(), permissions.router('datasets', 'dataset'))

// retrieve a dataset by its id
router.get('/:datasetId', readDataset(), applicationKey, permissions.middleware('readDescription', 'read'), cacheHeaders.noCache, (req, res, next) => {
  req.dataset.userPermissions = permissions.list('datasets', req.dataset, req.user)
  res.status(200).send(clean(req.dataset))
})

// retrieve only the schema.. Mostly useful for easy select fields
router.get('/:datasetId/schema', readDataset(), applicationKey, permissions.middleware('readDescription', 'read'), cacheHeaders.noCache, (req, res, next) => {
  let schema = req.dataset.schema
  schema.forEach(field => {
    field.label = field.title || field['x-originalName'] || field.key
  })
  if (req.query.type) {
    const types = req.query.type.split(',')
    schema = schema.filter(field => types.includes(field.type))
  }
  if (req.query.format) {
    const formats = req.query.format.split(',')
    schema = schema.filter(field => formats.includes(field.format))
  }
  if (req.query.enum === 'true') {
    schema = schema.filter(field => !!field.enum)
  }
  res.status(200).send(schema)
})

// Update a dataset's metadata
router.patch('/:datasetId', readDataset(['finalized', 'error']), permissions.middleware('writeDescription', 'write'), asyncWrap(async(req, res) => {
  const db = req.app.get('db')
  const patch = req.body
  if (!validatePatch(patch)) return res.status(400).send(validatePatch.errors)

  // Changed a previously failed dataset, retry everything.
  // Except download.. We only try it again if the fetch failed.
  if (req.dataset.status === 'error') {
    if (req.dataset.isVirtual) patch.status = 'indexed'
    else if (req.dataset.isRest) patch.status = 'schematized'
    else if (req.dataset.remoteFile && !req.dataset.originalFile) patch.status = 'imported'
    else if (!baseTypes.has(req.dataset.originalFile.mimetype)) patch.status = 'uploaded'
    else patch.status = 'loaded'
  }

  // Ignore patch that doesn't bring actual change
  Object.keys(patch).forEach(patchKey => {
    if (JSON.stringify(patch[patchKey]) === JSON.stringify(req.dataset[patchKey])) { delete patch[patchKey] }
  })
  if (Object.keys(patch).length === 0) return res.status(200).send(clean(req.dataset))

  patch.updatedAt = moment().toISOString()
  patch.updatedBy = { id: req.user.id, name: req.user.name }
  if (patch.extensions) patch.schema = await extensions.prepareSchema(db, patch.schema || req.dataset.schema, patch.extensions)

  // Re-publish publications
  if (!patch.publications && req.dataset.publications && req.dataset.publications.length) {
    req.dataset.publications.filter(p => p.status !== 'deleted').forEach(p => { p.status = 'waiting' })
    patch.publications = req.dataset.publications
  }

  if (req.dataset.isVirtual) {
    if (patch.schema || patch.virtual) {
      patch.schema = await virtualDatasetsUtils.prepareSchema(db, { ...req.dataset, ...patch })
      patch.status = 'indexed'
    }
  } else if (patch.projection && (!req.dataset.projection || patch.projection.code !== req.dataset.projection.code)) {
    // geo projection has changed, trigger full re-indexing
    patch.status = 'schematized'
  } else if (patch.schema && geo.geoFieldsKey(patch.schema) !== geo.geoFieldsKey(req.dataset.schema)) {
    // geo concepts haved changed, trigger full re-indexing
    patch.status = 'schematized'
  } else if (patch.schema && patch.schema.find(f => req.dataset.schema.find(df => df.key === f.key && df.separator !== f.separator))) {
    // some separator has changed on a field, trigger full re-indexing
    patch.status = 'schematized'
  } else if (patch.schema && patch.schema.find(f => req.dataset.schema.find(df => df.key === f.key && df.ignoreDetection !== f.ignoreDetection))) {
    // some ignoreDetection param has changed on a field, trigger full analysis / re-indexing
    patch.status = 'loaded'
  } else if (patch.schema) {
    try {
      // this method will routinely throw errors
      // we just try in case elasticsearch considers the new mapping compatible
      // so that we might optimize and reindex only when necessary
      await esUtils.updateDatasetMapping(req.app.get('es'), { id: req.dataset.id, schema: patch.schema })
      if (patch.extensions) {
        // Back to indexed state if schema did not change in significant manner, but extensions did
        patch.status = 'indexed'
      } else {
        // Extended otherwise, to re-calculate geometries and stuff
        patch.status = 'extended'
      }
    } catch (err) {
      // generated ES mappings are not compatible, trigger full re-indexing
      patch.status = 'schematized'
    }
  } else if (patch.thumbnails) {
    // just change finalizedAt so that cache is invalidated, but the worker doesn't relly need to work on the dataset
    patch.finalizedAt = (new Date()).toISOString()
  }

  const patchedDataset = (await req.app.get('db').collection('datasets')
    .findOneAndUpdate({ id: req.params.datasetId }, { $set: patch }, { returnOriginal: false })).value
  res.status(200).json(clean(patchedDataset))
}))

// Change ownership of a dataset
router.put('/:datasetId/owner', readDataset(), permissions.middleware('delete', 'admin'), asyncWrap(async(req, res) => {
  // Must be able to delete the current dataset, and to create a new one for the new owner to proceed
  if (!permissions.canDoForOwner(req.body, 'datasets', 'post', req.user)) return res.sendStatus(403)
  const patch = {
    owner: req.body,
    updatedBy: { id: req.user.id, name: req.user.name },
    updatedAt: moment().toISOString(),
  }
  const patchedDataset = (await req.app.get('db').collection('datasets')
    .findOneAndUpdate({ id: req.params.datasetId }, { $set: patch }, { returnOriginal: false })).value

  // Move all files
  try {
    await fs.move(datasetUtils.dir(req.dataset), datasetUtils.dir(patchedDataset))
  } catch (err) {
    console.error('Error while moving dataset directory', err)
  }
  res.status(200).json(clean(patchedDataset))
}))

// Delete a dataset
router.delete('/:datasetId', readDataset(), permissions.middleware('delete', 'admin'), asyncWrap(async(req, res) => {
  await datasetUtils.delete(req.app.get('db'), req.app.get('es'), req.dataset)
  res.sendStatus(204)
}))

const initNew = (req) => {
  const dataset = { ...req.body }
  dataset.owner = usersUtils.owner(req)
  const date = moment().toISOString()
  dataset.createdAt = dataset.updatedAt = date
  dataset.createdBy = dataset.updatedBy = { id: req.user.id, name: req.user.name }
  dataset.permissions = []
  dataset.schema = dataset.schema || []
  return dataset
}

const setFileInfo = async (db, file, attachmentsFile, dataset) => {
  if (!dataset.id) {
    const baseTitle = dataset.title || path.parse(file.originalname).name.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ').split(/\s+/).join(' ')
    const baseId = slug(baseTitle, { lower: true })
    dataset.id = baseId
    dataset.title = baseTitle
    let i = 1; let dbExists = false; let fileExists = false
    do {
      if (i > 1) {
        dataset.id = baseId + i
        dataset.title = baseTitle + ' ' + i
      }
      // better to check file as well as db entry in case of file currently uploading
      dbExists = await db.collection('datasets').countDocuments({ id: dataset.id })
      fileExists = await fs.exists(datasetUtils.dir(dataset))
      i += 1
    } while (dbExists || fileExists)

    await fs.ensureDir(datasetUtils.dir(dataset))
    await fs.move(file.path, path.join(datasetUtils.dir(dataset), file.originalname))
  }
  dataset.title = dataset.title || file.title
  dataset.originalFile = {
    name: file.originalname,
    size: file.size,
    mimetype: file.mimetype,
  }
  if (!baseTypes.has(file.mimetype)) {
    // we first need to convert the file in a textual format easy to index
    dataset.status = 'uploaded'
  } else {
    // The format of the original file is already well suited to workers
    dataset.status = 'loaded'
    dataset.file = dataset.originalFile
    const fileName = datasetUtils.fileName(dataset)
    // Try to prevent weird bug with NFS by forcing syncing file before sampling
    const fd = await fs.open(fileName, 'r')
    await fs.fsync(fd)
    await fs.close(fd)
    const fileSample = await datasetFileSample(dataset)
    debugFiles(`Attempt to detect encoding from ${fileSample.length} first bytes of file ${fileName}`)
    dataset.file.encoding = chardet.detect(fileSample)
    debugFiles(`Detected encoding ${dataset.file.encoding} for file ${fileName}`)
  }

  if (attachmentsFile) {
    await attachments.replaceAllAttachments(dataset, attachmentsFile)
  }
  return dataset
}

// Create a dataset by uploading data
const beforeUpload = asyncWrap(async(req, res, next) => {
  if (!req.user) return res.status(401).send()
  if (!permissions.canDoForOwner(usersUtils.owner(req), 'datasets', 'post', req.user, req.app.get('db'))) return res.sendStatus(403)
  next()
})
router.post('', beforeUpload, checkStorage(true), filesUtils.uploadFile(validatePost), asyncWrap(async(req, res) => {
  req.files = req.files || []
  debugFiles('POST datasets uploaded some files', req.files)
  try {
    const db = req.app.get('db')

    let dataset
    // After uploadFile, req.files contains the metadata of an uploaded file, and req.body the content of additional text fields
    const datasetFile = req.files.find(f => f.fieldname === 'file' || f.fieldname === 'dataset')
    const attachmentsFile = req.files.find(f => f.fieldname === 'attachments')
    if (datasetFile) {
      if (req.body.isVirtual) throw createError(400, 'Un jeu de données virtuel ne peut pas être initialisé avec un fichier')

      // send header at this point, then asyncWrap keepalive option will keep request alive while we process files
      // TODO: do this in a worker instead ?
      res.writeHeader(201, { 'Content-Type': 'application/json' })
      res.write(' ')

      dataset = await setFileInfo(db, datasetFile, attachmentsFile, initNew(req))
      await db.collection('datasets').insertOne(dataset)
    } else if (req.body.isVirtual) {
      if (!req.body.title) throw createError(400, 'Un jeu de données virtuel doit être créé avec un titre')
      if (attachmentsFile) throw createError(400, 'Un jeu de données virtuel ne peut pas avoir de pièces jointes')
      if (!validatePost(req.body)) {
        throw createError(400, JSON.stringify(validatePost.errors))
      }
      dataset = initNew(req)
      dataset.virtual = dataset.virtual || { children: [] }
      dataset.schema = await virtualDatasetsUtils.prepareSchema(db, dataset)
      dataset.status = 'indexed'
      const baseId = slug(req.body.title).toLowerCase()
      await datasetUtils.insertWithBaseId(db, dataset, baseId)
    } else if (req.body.isRest) {
      if (!req.body.title) throw createError(400, 'Un jeu de données REST doit être créé avec un titre')
      if (attachmentsFile) throw createError(400, 'Un jeu de données REST ne peut pas être créé avec des pièces jointes')
      if (!validatePost(req.body)) {
        throw createError(400, JSON.stringify(validatePost.errors))
      }
      dataset = initNew(req)
      dataset.rest = dataset.rest || {}
      dataset.schema = dataset.schema || []
      // create it with finalized status to prevent worker from acquiring it before collection is fully created
      dataset.status = 'finalized'
      const baseId = slug(req.body.title).toLowerCase()
      await datasetUtils.insertWithBaseId(db, dataset, baseId)
      await restDatasetsUtils.initDataset(db, dataset)
      await db.collection('datasets').updateOne({ id: dataset.id }, { $set: { status: 'schematized' } })
    } else {
      throw createError(400, 'Un jeu de données doit être initialisé avec un fichier ou déclaré "virtuel" ou "REST"')
    }

    delete dataset._id

    await Promise.all([
      journals.log(req.app, dataset, { type: 'dataset-created', href: config.publicUrl + '/dataset/' + dataset.id }, 'dataset'),
      datasetUtils.updateStorage(db, dataset),
    ])
    res.status(201).send(clean(dataset))
  } catch (err) {
    // Wrapped the whole thing in a try/catch to remove files in case of failure
    for (const file of req.files) {
      await fs.remove(file.path)
    }
    throw err
  }
}, { keepalive: true }))

// PUT or POST with an id to create or update an existing dataset data
const attemptInsert = asyncWrap(async(req, res, next) => {
  if (!req.user) return res.status(401).send()

  const newDataset = initNew(req)
  newDataset.id = req.params.datasetId

  // Try insertion if the user is authorized, in case of conflict go on with the update scenario
  if (permissions.canDoForOwner(newDataset.owner, 'datasets', 'post', req.user, req.app.get('db'))) {
    try {
      await req.app.get('db').collection('datasets').insertOne(newDataset, true)
      req.isNewDataset = true
    } catch (err) {
      if (err.code !== 11000) throw err
    }
  }
  next()
})
const updateDataset = asyncWrap(async(req, res) => {
  req.files = req.files || []
  debugFiles('PUT datasets uploaded some files', req.files)
  try {
    const db = req.app.get('db')
    // After uploadFile, req.files contains the metadata of an uploaded file, and req.body the content of additional text fields
    const datasetFile = req.files.find(f => f.fieldname === 'file' || f.fieldname === 'dataset')
    const attachmentsFile = req.files.find(f => f.fieldname === 'attachments')
    if (!datasetFile && !req.dataset.isVirtual && !req.dataset.isRest) throw createError(400, 'Un jeu de données doit être initialisé avec un fichier ou déclaré "virtuel"')
    if (datasetFile && (req.dataset.isVirtual || req.dataset.isRest)) throw createError(400, 'Un jeu de données est soit initialisé avec un fichier soit déclaré "virtuel"')
    if (req.dataset.isVirtual && !req.dataset.title) throw createError(400, 'Un jeu de données virtuel doit être créé avec un titre')
    if (req.dataset.isRest && !req.dataset.title) throw createError(400, 'Un jeu de données REST doit être créé avec un titre')
    if (req.dataset.isVirtual && attachmentsFile) throw createError(400, 'Un jeu de données virtuel ne peut pas avoir des pièces jointes')
    if (req.dataset.isRest && attachmentsFile) throw createError(400, 'Un jeu de données REST ne peut pas être créé avec des pièces jointes')

    let dataset = req.dataset
    if (datasetFile) {
      // send header at this point, then asyncWrap keepalive option will keep request alive while we process files
      // TODO: do this in a worker instead ?
      res.writeHeader(req.isNewDataset ? 201 : 200, { 'Content-Type': 'application/json' })
      res.write(' ')

      dataset = await setFileInfo(db, datasetFile, attachmentsFile, req.dataset)
    } else if (dataset.isVirtual) {
      const { isVirtual, ...patch } = req.body
      if (!validatePatch(patch)) {
        throw createError(400, validatePatch.errors)
      }
      req.body.virtual = req.body.virtual || { children: [] }
      req.body.schema = await virtualDatasetsUtils.prepareSchema(db, { ...dataset, ...req.body })
      req.body.status = 'indexed'
    } else if (dataset.isRest) {
      const { isRest, ...patch } = req.body
      if (!validatePatch(patch)) {
        throw createError(400, validatePatch.errors)
      }
      req.body.rest = req.body.rest || {}
      dataset.schema = dataset.schema || []
      if (req.isNewDataset) {
        await restDatasetsUtils.initDataset(db, dataset)
        dataset.status = 'schematized'
      } else {
        try {
          // this method will routinely throw errors
          // we just try in case elasticsearch considers the new mapping compatible
          // so that we might optimize and reindex only when necessary
          await esUtils.updateDatasetMapping(req.app.get('es'), { id: req.dataset.id, schema: req.body.schema })
          // Back to indexed state if schema did not change in significant manner
          patch.status = 'indexed'
        } catch (err) {
          // generated ES mappings are not compatible, trigger full re-indexing
          patch.status = 'schematized'
        }
      }
    }
    Object.assign(dataset, req.body)

    dataset.updatedBy = { id: req.user.id, name: req.user.name }
    dataset.updatedAt = moment().toISOString()
    await db.collection('datasets').replaceOne({ id: req.params.datasetId }, dataset)
    if (req.isNewDataset) await journals.log(req.app, dataset, { type: 'dataset-created' }, 'dataset')
    else if (!dataset.isRest && !dataset.isVirtual) await journals.log(req.app, dataset, { type: 'data-updated' }, 'dataset')
    await datasetUtils.updateStorage(db, req.dataset)
    res.status(req.isNewDataset ? 201 : 200).send(clean(dataset))
  } catch (err) {
    // Wrapped the whole thing in a try/catch to remove files in case of failure
    for (const file of req.files) {
      await fs.remove(file.path)
    }
    throw err
  }
}, { keepalive: true })
router.post('/:datasetId', attemptInsert, readDataset(['finalized', 'error']), permissions.middleware('writeData', 'write'), checkStorage(true), filesUtils.uploadFile(validatePatch), updateDataset)
router.put('/:datasetId', attemptInsert, readDataset(['finalized', 'error']), permissions.middleware('writeData', 'write'), checkStorage(true), filesUtils.uploadFile(validatePatch), updateDataset)

// CRUD operations for REST datasets
function isRest(req, res, next) {
  if (!req.dataset.isRest) {
    return res.status(501)
      .send('Les opérations de modifications sur les lignes sont uniquement accessibles pour les jeux de données de type REST.')
  }
  next()
}
router.get('/:datasetId/lines/:lineId', readDataset(), isRest, permissions.middleware('readLine', 'read'), cacheHeaders.noCache, asyncWrap(restDatasetsUtils.readLine))
router.post('/:datasetId/lines', readDataset(['finalized', 'updated', 'indexed']), isRest, permissions.middleware('createLine', 'write'), checkStorage(false), restDatasetsUtils.uploadAttachment, asyncWrap(restDatasetsUtils.createLine))
router.put('/:datasetId/lines/:lineId', readDataset(['finalized', 'updated', 'indexed']), isRest, permissions.middleware('updateLine', 'write'), checkStorage(false), restDatasetsUtils.uploadAttachment, asyncWrap(restDatasetsUtils.updateLine))
router.patch('/:datasetId/lines/:lineId', readDataset(['finalized', 'updated', 'indexed']), isRest, permissions.middleware('patchLine', 'write'), checkStorage(false), restDatasetsUtils.uploadAttachment, asyncWrap(restDatasetsUtils.patchLine))
router.post('/:datasetId/_bulk_lines', readDataset(['finalized', 'updated', 'indexed']), isRest, permissions.middleware('bulkLines', 'write'), checkStorage(false), restDatasetsUtils.uploadBulk, asyncWrap(restDatasetsUtils.bulkLines))
router.delete('/:datasetId/lines/:lineId', readDataset(['finalized', 'updated', 'indexed']), isRest, permissions.middleware('deleteLine', 'write'), asyncWrap(restDatasetsUtils.deleteLine))
router.get('/:datasetId/lines/:lineId/revisions', readDataset(['finalized', 'updated', 'indexed']), isRest, permissions.middleware('readLineRevisions', 'read'), asyncWrap(restDatasetsUtils.readLineRevisions))

// Error from ES backend should be stored in the journal
async function manageESError(req, err) {
  // console.error('Elasticsearch error', JSON.stringify(err.body || err, null, 2))
  const errBody = (err.body && err.body.error) || {}
  let message = err.message
  if (errBody.root_cause && errBody.root_cause.reason) message = errBody.root_cause.reason
  if (errBody.failed_shards && errBody.failed_shards[0] && errBody.failed_shards[0].reason) {
    const shardReason = errBody.failed_shards[0].reason
    if (shardReason.caused_by && shardReason.caused_by.reason) {
      message = shardReason.caused_by.reason
    } else {
      message = shardReason.reason || shardReason
    }
  }

  if (req.dataset.status === 'finalized' && err.statusCode >= 404 && errBody.type !== 'search_phase_execution_exception') {
    await req.app.get('db').collection('datasets').updateOne({ id: req.params.datasetId }, { $set: { status: 'error' } })
    await journals.log(req.app, req.dataset, { type: 'error', data: message })
  }
  throw createError(err.status, message)
}

// Read/search data for a dataset
router.get('/:datasetId/lines', readDataset(), applicationKey, permissions.middleware('readLines', 'read'), cacheHeaders.resourceBased, asyncWrap(async(req, res) => {
  if (req.query && req.query.page && req.query.size && req.query.page * req.query.size > 10000) {
    return res.status(404).send('You can only access the first 10 000 elements.')
  }

  const db = req.app.get('db')

  // used later to count items in a tile or tile's neighbor
  async function countWithCache(query) {
    const { hash, value } = await cache.get(db, {
      type: 'tile-count',
      datasetId: req.dataset.id,
      finalizedAt: req.dataset.finalizedAt,
      query,
    })
    if (value !== null) return value
    const newValue = await esUtils.count(req.app.get('es'), req.dataset, query)
    cache.set(db, hash, newValue)
    return newValue
  }

  // if the output format is geo make sure geoshape is present
  // also manage a default content for geo tiles that is the same as the one used to build mbtiles when possible
  const emptySelect = !req.query.select
  if (['geojson', 'mvt', 'vt', 'pbf'].includes(req.query.format)) {
    req.query.select = (req.query.select ? req.query.select : tiles.defaultSelect(req.dataset).join(','))
    if (!req.query.select.includes('_geoshape')) req.query.select += ',_geoshape'
  }

  if (req.dataset.isVirtual) req.dataset.descendants = await virtualDatasetsUtils.descendants(db, req.dataset)

  // geojson format benefits from bbox info
  let bboxPromise
  if (req.query.format === 'geojson') {
    bboxPromise = esUtils.bboxAgg(req.app.get('es'), req.dataset, { ...req.query })
  }

  const sampling = req.query.sampling || 'neighbors'
  if (!['max', 'neighbors'].includes(sampling)) return res.status(400).send('Sampling can be "max" or "neighbors"')

  const vectorTileRequested = ['mvt', 'vt', 'pbf'].includes(req.query.format)

  let xyz
  if (vectorTileRequested) {
    // default is 20 for other format, but we want filled tiles by default
    req.query.size = req.query.size || '10000'
    // sorting by rand provides more homogeneous distribution in tiles
    req.query.sort = req.query.sort || '_rand'
    if (!req.query.xyz) return res.status(400).send('xyz parameter is required for vector tile format.')
    xyz = req.query.xyz.split(',').map(Number)
  }

  // Is the tile cached ?
  let cacheHash
  if (vectorTileRequested && !config.cache.disabled) {
    const { hash, value } = await cache.get(db, {
      type: 'tile',
      sampling,
      datasetId: req.dataset.id,
      finalizedAt: req.dataset.finalizedAt,
      query: req.query,
    })
    if (value) {
      res.type('application/x-protobuf')
      res.setHeader('x-tilesmode', 'cache')
      res.throttleEnd('static')
      return res.status(200).send(value.buffer)
    }
    cacheHash = hash
  }

  // if vector tile is requested and we dispose of a prerendered mbtiles file, use it
  // otherwise (older dataset, or rest/virtual datasets) we use tile generation from ES results
  if (!req.dataset.isVirtual && !req.dataset.isRest) {
    const mbtilesPath = datasetUtils.extFileName(req.dataset, 'mbtiles')
    if (vectorTileRequested && !req.query.q && !req.query.qs && await fs.exists(mbtilesPath)) {
      const tile = await tiles.getTile(req.dataset, mbtilesPath, !emptySelect && req.query.select.split(','), ...xyz)
      if (tile) {
        res.type('application/x-protobuf')
        res.setHeader('x-tilesmode', 'mbtiles')
        res.throttleEnd('static')
        if (!config.cache.disabled) cache.set(db, cacheHash, new mongodb.Binary(tile))
        return res.status(200).send(tile)
      } else if (tile === null) {
        res.setHeader('x-tilesmode', 'mbtiles')
        // 204 = no-content, better than 404
        return res.status(204).send()
      }
    }
  }

  if (vectorTileRequested) {
    res.setHeader('x-tilesmode', 'es')

    const requestedSize = req.query.size ? Number(req.query.size) : 20
    if (requestedSize > 10000) throw createError(400, '"size" cannot be more than 10000')
    if (sampling === 'neighbors') {
      // count docs in neighboring tiles to perform intelligent sampling
      try {
        const mainCount = await countWithCache(req.query)
        if (mainCount === 0) return res.status(204).send()
        if (mainCount <= requestedSize / 20) {
          // no sampling on low density tiles
          req.query.size = requestedSize
        } else {
          const neighborsCounts = await Promise.all([
            // the 4 that share an edge
            countWithCache({ ...req.query, xyz: [xyz[0] - 1, xyz[1], xyz[2]].join(',') }),
            countWithCache({ ...req.query, xyz: [xyz[0] + 1, xyz[1], xyz[2]].join(',') }),
            countWithCache({ ...req.query, xyz: [xyz[0], xyz[1] - 1, xyz[2]].join(',') }),
            countWithCache({ ...req.query, xyz: [xyz[0], xyz[1] + 1, xyz[2]].join(',') }),
            // Using corners also yields better results
            countWithCache({ ...req.query, xyz: [xyz[0] - 1, xyz[1] - 1, xyz[2]].join(',') }),
            countWithCache({ ...req.query, xyz: [xyz[0] + 1, xyz[1] - 1, xyz[2]].join(',') }),
            countWithCache({ ...req.query, xyz: [xyz[0] - 1, xyz[1] + 1, xyz[2]].join(',') }),
            countWithCache({ ...req.query, xyz: [xyz[0] + 1, xyz[1] + 1, xyz[2]].join(',') }),
          ])
          const maxCount = Math.max(mainCount, ...neighborsCounts)
          const sampleRate = requestedSize / Math.max(requestedSize, maxCount)
          const sizeFilter = mainCount * sampleRate
          req.query.size = Math.min(sizeFilter, requestedSize)
        }
      } catch (err) {
        await manageESError(req, err)
      }
    }
  }

  let esResponse
  try {
    esResponse = await esUtils.search(req.app.get('es'), req.dataset, req.query)
  } catch (err) {
    await manageESError(req, err)
  }
  if (req.query.format === 'geojson') {
    const geojson = geo.result2geojson(esResponse)
    geojson.bbox = (await bboxPromise).bbox
    res.setHeader('content-disposition', `attachment; filename="${req.dataset.id}.geojson"`)
    res.throttleEnd()
    webhooks.trigger(req.app.get('db'), 'dataset', req.dataset, { type: 'downloaded-filter' })
    return res.status(200).send(geojson)
  }

  if (vectorTileRequested) {
    const tile = tiles.geojson2pbf(geo.result2geojson(esResponse), xyz)
    // 204 = no-content, better than 404
    if (!tile) return res.status(204).send()
    res.type('application/x-protobuf')
    // write in cache without await on purpose for minimal latency, a cache failure must be detected in the logs
    if (!config.cache.disabled) cache.set(db, cacheHash, new mongodb.Binary(tile))
    res.throttleEnd()
    return res.status(200).send(tile)
  }

  const result = {
    total: esResponse.hits.total.value,
    results: esResponse.hits.hits.map(hit => {
      return esUtils.prepareResultItem(hit, req.dataset, req.query)
    }),
  }

  if (req.query.format === 'csv') {
    res.setHeader('content-disposition', `attachment; filename="${req.dataset.id}.csv"`)
    // add BOM for excel, cf https://stackoverflow.com/a/17879474
    res.write('\ufeff')
    const csvStreams = outputs.result2csv(req.dataset, req.query, result)
    const streamPromise = pump(
      ...csvStreams,
      res.throttle('dynamic'),
      res,
    )
    for (const line of result.results) {
      await new Promise((resolve, reject) => {
        csvStreams[0].write(line, (err) => {
          if (err) reject(err)
          resolve(err)
        })
      })
    }
    csvStreams[0].end()
    await streamPromise
    webhooks.trigger(req.app.get('db'), 'dataset', req.dataset, { type: 'downloaded-filter' })
    return
  }

  res.throttleEnd()
  res.status(200).send(result)
}))

// Special geo aggregation
router.get('/:datasetId/geo_agg', readDataset(), applicationKey, permissions.middleware('getGeoAgg', 'read'), cacheHeaders.resourceBased, asyncWrap(async(req, res) => {
  res.throttleEnd()
  if (req.dataset.isVirtual) req.dataset.descendants = await virtualDatasetsUtils.descendants(req.app.get('db'), req.dataset)
  const db = req.app.get('db')

  const vectorTileRequested = ['mvt', 'vt', 'pbf'].includes(req.query.format)
  // Is the tile cached ?
  let cacheHash
  if (vectorTileRequested && !config.cache.disabled) {
    const { hash, value } = await cache.get(db, {
      type: 'tile-geoagg',
      datasetId: req.dataset.id,
      finalizedAt: req.dataset.finalizedAt,
      query: req.query,
    })
    if (value) return res.status(200).send(value.buffer)
    cacheHash = hash
  }
  let result
  try {
    result = await esUtils.geoAgg(req.app.get('es'), req.dataset, req.query)
  } catch (err) {
    await manageESError(req, err)
  }

  if (req.query.format === 'geojson') {
    const geojson = geo.aggs2geojson(result)
    geojson.bbox = (await esUtils.bboxAgg(req.app.get('es'), req.dataset, { ...req.query })).bbox
    return res.status(200).send(geojson)
  }

  if (vectorTileRequested) {
    if (!req.query.xyz) return res.status(400).send('xyz parameter is required for vector tile format.')
    const tile = tiles.geojson2pbf(geo.aggs2geojson(result), req.query.xyz.split(',').map(Number))
    // 204 = no-content, better than 404
    if (!tile) return res.status(204).send()
    res.type('application/x-protobuf')
    // write in cache without await on purpose for minimal latency, a cache failure must be detected in the logs
    if (!config.cache.disabled) cache.set(db, cacheHash, new mongodb.Binary(tile))
    return res.status(200).send(tile)
  }

  res.status(200).send(result)
}))

// Standard aggregation to group items by value and perform an optional metric calculation on each group
router.get('/:datasetId/values_agg', readDataset(), applicationKey, permissions.middleware('getValuesAgg', 'read'), cacheHeaders.resourceBased, asyncWrap(async(req, res) => {
  res.throttleEnd()
  if (req.dataset.isVirtual) req.dataset.descendants = await virtualDatasetsUtils.descendants(req.app.get('db'), req.dataset)
  const db = req.app.get('db')

  const vectorTileRequested = ['mvt', 'vt', 'pbf'].includes(req.query.format)
  // Is the tile cached ?
  let cacheHash
  if (vectorTileRequested && !config.cache.disabled) {
    const { hash, value } = await cache.get(db, {
      type: 'tile-valuesagg',
      datasetId: req.dataset.id,
      finalizedAt: req.dataset.finalizedAt,
      query: req.query,
    })
    if (value) return res.status(200).send(value.buffer)
    cacheHash = hash
  }

  let result
  try {
    result = await esUtils.valuesAgg(req.app.get('es'), req.dataset, req.query, vectorTileRequested || req.query.format === 'geojson')
  } catch (err) {
    await manageESError(req, err)
  }

  if (req.query.format === 'geojson') {
    const geojson = geo.aggs2geojson(result)
    geojson.bbox = (await esUtils.bboxAgg(req.app.get('es'), req.dataset, { ...req.query })).bbox
    return res.status(200).send(geojson)
  }

  if (vectorTileRequested) {
    if (!req.query.xyz) return res.status(400).send('xyz parameter is required for vector tile format.')
    const tile = tiles.geojson2pbf(geo.aggs2geojson(result), req.query.xyz.split(',').map(Number))
    // 204 = no-content, better than 404
    if (!tile) return res.status(204).send()
    res.type('application/x-protobuf')
    // write in cache without await on purpose for minimal latency, a cache failure must be detected in the logs
    if (!config.cache.disabled) cache.set(db, cacheHash, new mongodb.Binary(tile))
    return res.status(200).send(tile)
  }

  res.status(200).send(result)
}))

// Simpler values list and filter (q is applied only to the selected field, not all fields)
// mostly useful for selects/autocompletes on values
router.get('/:datasetId/values/:fieldKey', readDataset(), applicationKey, permissions.middleware('getValues', 'read'), cacheHeaders.resourceBased, asyncWrap(async(req, res) => {
  res.throttleEnd()
  if (req.dataset.isVirtual) req.dataset.descendants = await virtualDatasetsUtils.descendants(req.app.get('db'), req.dataset)
  let result
  try {
    result = await esUtils.values(req.app.get('es'), req.dataset, req.params.fieldKey, req.query)
  } catch (err) {
    await manageESError(req, err)
  }
  res.status(200).send(result)
}))

// Simple metric aggregation to calculate some value (sum, avg, etc.)
router.get('/:datasetId/metric_agg', readDataset(), applicationKey, permissions.middleware('getMetricAgg', 'read'), cacheHeaders.resourceBased, asyncWrap(async(req, res) => {
  res.throttleEnd()
  if (req.dataset.isVirtual) req.dataset.descendants = await virtualDatasetsUtils.descendants(req.app.get('db'), req.dataset)
  let result
  try {
    result = await esUtils.metricAgg(req.app.get('es'), req.dataset, req.query)
  } catch (err) {
    await manageESError(req, err)
  }
  res.status(200).send(result)
}))

// Simple words aggregation for significant terms extraction
router.get('/:datasetId/words_agg', readDataset(), applicationKey, permissions.middleware('getWordsAgg', 'read'), cacheHeaders.resourceBased, asyncWrap(async(req, res) => {
  res.throttleEnd()
  if (req.dataset.isVirtual) req.dataset.descendants = await virtualDatasetsUtils.descendants(req.app.get('db'), req.dataset)
  let result
  try {
    result = await esUtils.wordsAgg(req.app.get('es'), req.dataset, req.query)
  } catch (err) {
    await manageESError(req, err)
  }
  res.status(200).send(result)
}))

// Get max value of a field
router.get('/:datasetId/max/:fieldKey', readDataset(), applicationKey, permissions.middleware('getWordsAgg', 'read'), cacheHeaders.resourceBased, asyncWrap(async(req, res) => {
  if (req.dataset.isVirtual) req.dataset.descendants = await virtualDatasetsUtils.descendants(req.app.get('db'), req.dataset)
  let result
  try {
    result = await esUtils.maxAgg(req.app.get('es'), req.dataset, req.params.fieldKey, req.query)
  } catch (err) {
    await manageESError(req, err)
  }
  res.status(200).send(result)
}))

// Get min value of a field
router.get('/:datasetId/min/:fieldKey', readDataset(), applicationKey, permissions.middleware('getWordsAgg', 'read'), cacheHeaders.resourceBased, asyncWrap(async(req, res) => {
  if (req.dataset.isVirtual) req.dataset.descendants = await virtualDatasetsUtils.descendants(req.app.get('db'), req.dataset)
  let result
  try {
    result = await esUtils.minAgg(req.app.get('es'), req.dataset, req.params.fieldKey, req.query)
  } catch (err) {
    await manageESError(req, err)
  }
  res.status(200).send(result)
}))

// For datasets with attached files
router.get('/:datasetId/attachments/*', readDataset(), applicationKey, permissions.middleware('downloadOriginalData', 'read'), cacheHeaders.noCache, (req, res, next) => {
  const filePath = req.params['0']
  if (filePath.includes('..')) return res.status(400).send('Unacceptable attachment path')
  // the transform stream option was patched into "send" module using patch-package
  res.download(path.resolve(datasetUtils.attachmentsDir(req.dataset), filePath), null, { transformStream: res.throttle('static') })
})

// Direct access to data files
router.get('/:datasetId/data-files', readDataset(), permissions.middleware('downloadFullData', 'read'), asyncWrap(async(req, res, next) => {
  res.send(await datasetUtils.dataFiles(req.dataset))
}))
router.get('/:datasetId/data-files/*', readDataset(), permissions.middleware('downloadFullData', 'read'), cacheHeaders.noCache, asyncWrap(async(req, res, next) => {
  const filePath = req.params['0']
  if (filePath.includes('..')) return res.status(400).send('Unacceptable data file path')
  // the transform stream option was patched into "send" module using patch-package
  res.download(path.resolve(datasetUtils.dir(req.dataset), filePath), null, { transformStream: res.throttle('static') })
}))

// Special attachments referenced in dataset metadatas
router.post('/:datasetId/metadata-attachments', readDataset(), permissions.middleware('writeData', 'write'), checkStorage(false), attachments.metadataUpload(), asyncWrap(async(req, res, next) => {
  req.body.size = (await fs.promises.stat(req.file.path)).size
  req.body.updatedAt = moment().toISOString()
  await datasetUtils.updateStorage(req.app.get('db'), req.dataset)
  res.status(200).send(req.body)
}))
router.get('/:datasetId/metadata-attachments/*', readDataset(), permissions.middleware('downloadOriginalData', 'read'), cacheHeaders.noCache, (req, res, next) => {
  const filePath = req.params['0']
  if (filePath.includes('..')) return res.status(400).send('Unacceptable attachment path')
  // the transform stream option was patched into "send" module using patch-package
  res.download(path.resolve(datasetUtils.metadataAttachmentsDir(req.dataset), filePath), null, { transformStream: res.throttle('static') })
})
router.delete('/:datasetId/metadata-attachments/*', readDataset(), permissions.middleware('writeData', 'write'), asyncWrap(async(req, res, next) => {
  const filePath = req.params['0']
  if (filePath.includes('..')) return res.status(400).send('Unacceptable attachment path')
  await fs.remove(path.join(datasetUtils.metadataAttachmentsDir(req.dataset), filePath))
  await datasetUtils.updateStorage(req.app.get('db'), req.dataset)
  res.status(204).send()
}))

// Download the full dataset in its original form
router.get('/:datasetId/raw', readDataset(), permissions.middleware('downloadOriginalData', 'read'), cacheHeaders.noCache, (req, res, next) => {
  // the transform stream option was patched into "send" module using patch-package
  res.download(datasetUtils.originalFileName(req.dataset), null, { transformStream: res.throttle('static') })
  webhooks.trigger(req.app.get('db'), 'dataset', req.dataset, { type: 'downloaded' })
})

// Download the dataset in various formats
router.get('/:datasetId/convert', readDataset(), permissions.middleware('downloadOriginalData', 'read'), cacheHeaders.noCache, (req, res, next) => {
  if (!req.query || !req.query.format) {
    // the transform stream option was patched into "send" module using patch-package
    res.download(datasetUtils.fileName(req.dataset), null, { transformStream: res.throttle('static') })
    webhooks.trigger(req.app.get('db'), 'dataset', req.dataset, { type: 'downloaded' })
  } else {
    res.status(400).send(`Format ${req.query.format} is not supported.`)
  }
})

// Download the full dataset with extensions
// TODO use ES scroll functionality instead of file read + extensions
router.get('/:datasetId/full', readDataset(), permissions.middleware('downloadFullData', 'read'), cacheHeaders.noCache, asyncWrap(async (req, res, next) => {
  // the transform stream option was patched into "send" module using patch-package
  if (await fs.exists(datasetUtils.fullFileName(req.dataset))) {
    res.download(datasetUtils.fullFileName(req.dataset), null, { transformStream: res.throttle('static') })
  } else {
    res.download(datasetUtils.fileName(req.dataset), null, { transformStream: res.throttle('static') })
  }
  webhooks.trigger(req.app.get('db'), 'dataset', req.dataset, { type: 'downloaded' })
}))

router.get('/:datasetId/api-docs.json', readDataset(), permissions.middleware('readApiDoc', 'read'), cacheHeaders.resourceBased, (req, res) => {
  res.send(req.resourceApiDoc)
})

router.get('/:datasetId/journal', readDataset(), permissions.middleware('readJournal', 'read'), cacheHeaders.noCache, asyncWrap(async(req, res) => {
  const journal = await req.app.get('db').collection('journals').findOne({
    type: 'dataset',
    id: req.params.datasetId,
  })
  if (!journal) return res.send([])
  delete journal.owner
  journal.events.reverse()
  res.json(journal.events)
}))

// Special route with very technical informations to help diagnose bugs, broken indices, etc.
router.get('/:datasetId/_diagnose', readDataset(), cacheHeaders.noCache, asyncWrap(async(req, res) => {
  if (!req.user) return res.status(401).send()
  if (!req.user.adminMode) return res.status(403).send()
  const esInfos = await esUtils.datasetInfos(req.app.get('es'), req.dataset)
  const filesInfos = await datasetUtils.lsFiles(req.dataset)
  res.json({ filesInfos, esInfos })
}))

// Special admin route to force reindexing a dataset
router.post('/:datasetId/_reindex', readDataset(), asyncWrap(async(req, res) => {
  if (!req.user) return res.status(401).send()
  if (!req.user.adminMode) return res.status(403).send()
  const patchedDataset = await datasetUtils.reindex(req.app.get('db'), req.dataset)
  res.status(200).send(patchedDataset)
}))

// Special admin route to force refinalizing a dataset
router.post('/:datasetId/_refinalize', readDataset(), asyncWrap(async(req, res) => {
  if (!req.user) return res.status(401).send()
  if (!req.user.adminMode) return res.status(403).send()
  const patchedDataset = await datasetUtils.refinalize(req.app.get('db'), req.dataset)
  res.status(200).send(patchedDataset)
}))

module.exports = router
