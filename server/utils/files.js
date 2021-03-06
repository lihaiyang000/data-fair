const fs = require('fs-extra')
const config = require('config')
const path = require('path')
const multer = require('multer')
const createError = require('http-errors')
const shortid = require('shortid')
const mime = require('mime-types')
const datasetSchema = require('../../contract/dataset')
const fallbackMimeTypes = {
  dbf: 'application/dbase',
  dif: 'text/plain',
  fods: 'application/vnd.oasis.opendocument.spreadsheet',
}
const debug = require('debug')('files')

const { tabularTypes, geographicalTypes, archiveTypes, calendarTypes } = require('../workers/converter')

const storage = multer.diskStorage({
  destination: async function(req, file, cb) {
    try {
      if (req.dataset) {
        req.uploadDir = path.join(config.dataDir, req.dataset.owner.type, req.dataset.owner.id, 'datasets', req.dataset.id)
      } else {
        // a tmp dir in case of new dataset, it will be moved into the actual dataset directory after upload completion and final id atttribution
        req.uploadDir = path.join(config.dataDir, 'tmp', shortid.generate())
        // const owner = req.dataset ? req.dataset.owner : usersUtils.owner(req)
        // return path.join(config.dataDir, owner.type, owner.id, 'datasets', req.dataset.id)
      }
      debug('Create destination directory', req.uploadDir)
      await fs.ensureDir(req.uploadDir)
      cb(null, req.uploadDir)
    } catch (err) {
      cb(err)
    }
  },
  filename: async function(req, file, cb) {
    try {
      if (file.fieldname === 'attachments') {
        // creating empty file before streaming seems to fix some weird bugs with NFS
        await fs.ensureFile(path.join(req.uploadDir, 'attachments.zip'))
        return cb(null, 'attachments.zip')
      }

      if (req.dataset && req.dataset.originalFile && req.dataset.originalFile.name !== file.originalname) {
        throw new Error(`Pour mettre à jour le jeu de donnée vous devez charger un fichier avec le même nom ${req.dataset.originalFile.name}`)
      }

      // creating empty file before streaming seems to fix some weird bugs with NFS
      await fs.ensureFile(path.join(req.uploadDir, file.originalname))
      cb(null, file.originalname)
    } catch (err) {
      cb(err)
    }
  },
})

const allowedTypes = exports.allowedTypes = new Set(['text/csv', 'application/geo+json', ...tabularTypes, ...geographicalTypes, ...archiveTypes, ...calendarTypes])

// Form data fields are sent as strings, some have to be parsed as objects or arrays
const fixFormBody = (body) => {
  Object.keys(datasetSchema.properties)
    .filter(key => body[key] !== undefined)
    .filter(key => ['object', 'array'].includes(datasetSchema.properties[key].type))
    .forEach(key => {
      if (body[key].trim() === '') {
        delete body[key]
      } else {
        try {
          body[key] = JSON.parse(body[key])
        } catch (err) {
          throw createError('400', `Invalid JSON in part "${key}", ${err.message}`)
        }
      }
    })
}

exports.uploadFile = (validate) => {
  return multer({
    limits: {
      files: 2, // no more than the dataset file + attachments archive
    },
    storage,
    fileFilter: async function fileFilter(req, file, cb) {
      try {
        debug('Accept file ?', file.originalname)
        // Input verification, only performed once, not for attachments and dataset both
        if (!req.inputChecked) {
          if (!req.user) throw createError(401)
          if (!req.body) throw createError(400, 'Missing body')
          fixFormBody(req.body)
          const valid = validate(req.body)
          if (!valid) throw createError(400, JSON.stringify(validate.errors))
          req.inputChecked = true
        }

        // mime type is broken on windows it seems.. detect based on extension instead
        file.mimetype = mime.lookup(file.originalname) || fallbackMimeTypes[file.originalname.split('.').pop()] || file.originalname.split('.').pop()

        if (file.fieldname === 'file' || file.fieldname === 'dataset') {
          if (!allowedTypes.has(file.mimetype)) throw createError(400, file.mimetype + ' type is not supported')
        } else if (file.fieldname === 'attachments') {
          if (file.mimetype !== 'application/zip') throw createError(400, 'Les fichiers joints doivent être embarqués dans une archive zip')
        } else {
          throw createError(400, `Fichier dans un champ non supporté: "${file.fieldname}"`)
        }
        debug('File accepted', file.originalname)
        cb(null, true)
      } catch (err) {
        debug('File rejected', err)
        cb(err)
      }
    },
  }).any()
}
