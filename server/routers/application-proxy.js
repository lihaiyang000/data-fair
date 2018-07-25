const express = require('express')
const requestProxy = require('express-request-proxy')
const config = require('config')
const replaceStream = require('replacestream')
// const URL = require('url').URL
const asyncWrap = require('../utils/async-wrap')

const router = module.exports = express.Router()

// Proxy for applications
router.all('/:applicationId*', asyncWrap(async(req, res, next) => {
  const application = await req.app.get('db').collection('applications').findOne({
    id: req.params.applicationId
  })
  if (!application) return res.status(404).send('No application configured for this id')
  const exposedUrl = config.publicUrl + '/app/' + req.params.applicationId
  const headers = {
    'X-Exposed-Url': exposedUrl,
    'X-Application-Url': config.publicUrl + '/api/v1/applications/' + req.params.applicationId,
    'X-Directory-Url': config.directoryUrl,
    'X-API-Url': config.publicUrl + '/api/v1',
    // This header is deprecated, use X-Application-Url instead and concatenate /config to it
    'X-Config-Url': config.publicUrl + '/api/v1/applications/' + req.params.applicationId + '/config',
    'accept-encoding': 'identity'
  }
  const options = {url: application.url + '*', headers}

  // Small hack that mainly fixes a problem occuring in development
  if (application.url[application.url.length - 1] === '/' && req.params['0'][0] === '/') {
    req.params['0'] = req.params['0'].slice(1)
  }

  // Prevent infinite redirect loops
  // it seems that express routing does not catch a single '/' after /:applicationId*
  if (req.params['0'] === '') {
    req.params['0'] = '/'
  }

  // Transform HTML content from response to inject params.
  // Usefull for client-side only applications that cannot read the headers.
  options.transforms = [{
    name: 'config-injector',
    match: (resp) => {
      // No permanent redirects, they are a pain for developping, debugging, etc.
      if (resp.statusCode === 301) resp.statusCode = 302

      // Fix redirects
      if (resp.statusCode === 302) {
        resp.headers.location = resp.headers.location.replace(application.url, exposedUrl)
        resp.headers.location = resp.headers.location.replace(application.url.replace('https://', 'http://'), exposedUrl)
      }

      // Do not attempt to transform errors or redirects
      if (resp.statusCode !== 200) return false

      // Do not transform compressed content
      if (resp.headers['content-encoding'] && resp.headers['content-encoding'] !== 'identity') {
        console.error(`A proxied application (${req.originalUrl}) sent compressed data (${resp.headers['content-encoding']})`)
        return false
      }

      return resp.headers['content-type'] && resp.headers['content-type'].indexOf('text/html') === 0
    },
    transform: () => replaceStream('%DATA_FAIR_CONFIG%', JSON.stringify({
      exposedUrl,
      applicationId: req.params.applicationId,
      dataFairUrl: config.publicUrl,
      directoryUrl: config.directoryUrl
    }))
  }]
  requestProxy(options)(req, res, next)
}))
