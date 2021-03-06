const nock = require('nock')
const assert = require('assert').strict
const FormData = require('form-data')
const config = require('config')
const testUtils = require('./resources/test-utils')

const workers = require('../server/workers')

describe('Extensions', () => {
  it('Extend dataset using remote service', async function() {
    const ax = global.ax.dmeadus
    // Initial dataset with addresses
    let form = new FormData()
    let content = `label,adr
koumoul,19 rue de la voie lactée saint avé
other,unknown address
`
    form.append('file', content, 'dataset.csv')
    let res = await ax.post('/api/v1/datasets', form, { headers: testUtils.formHeaders(form) })
    assert.equal(res.status, 201)
    let dataset = await workers.hook(`finalizer/${res.data.id}`)

    // Prepare for extension using created remote service and patch dataset to ask for it
    let nockScope = nock('http://test.com', { reqheaders: { 'x-apiKey': config.defaultRemoteKey.value } })
      .post('/geocoder/coords').reply(200, (uri, requestBody) => {
        const inputs = requestBody.trim().split('\n').map(JSON.parse)
        assert.equal(inputs.length, 2)
        assert.deepEqual(Object.keys(inputs[0]), ['q', 'key'])
        return inputs.map(input => ({ key: input.key, lat: 10, lon: 10 }))
          .map(JSON.stringify).join('\n') + '\n'
      })
    dataset.schema.find(field => field.key === 'adr')['x-refersTo'] = 'http://schema.org/address'
    res = await ax.patch(`/api/v1/datasets/${dataset.id}`, {
      schema: dataset.schema,
      extensions: [{ active: true, remoteService: 'geocoder-koumoul', action: 'postCoords' }],
    })
    assert.equal(res.status, 200)
    dataset = await workers.hook(`finalizer/${dataset.id}`)
    nockScope.done()
    const extensionKey = `_ext_${'geocoder-koumoul'}_postCoords`
    assert.ok(dataset.schema.find(field => field.key === extensionKey + '.lat'))
    assert.ok(dataset.schema.find(field => field.key === extensionKey + '.lon'))
    // A search to check results
    res = await ax.get(`/api/v1/datasets/${dataset.id}/lines`)
    assert.equal(res.data.total, 2)
    assert.equal(res.data.results[0][extensionKey + '.lat'], 10)
    assert.equal(res.data.results[0][extensionKey + '.lon'], 10)

    // Add a line to dataset
    // Re-prepare for extension, it should only process the new line
    nockScope = nock('http://test.com').post('/geocoder/coords').reply(200, (uri, requestBody) => {
      const inputs = requestBody.trim().split('\n').map(JSON.parse)
      assert.equal(inputs.length, 1)
      assert.deepEqual(Object.keys(inputs[0]), ['q', 'key'])
      return inputs.map(input => ({ key: input.key, lat: 50, lon: 50 }))
        .map(JSON.stringify).join('\n') + '\n'
    })
    form = new FormData()
    content += 'me,3 les noés la chapelle caro\n'
    form.append('file', content, 'dataset.csv')
    res = await ax.post(`/api/v1/datasets/${dataset.id}`, form, { headers: testUtils.formHeaders(form) })
    assert.equal(res.status, 200)
    await workers.hook(`finalizer/${dataset.id}`)
    nockScope.done()
    // A search to check re-indexed results with preserved extensions
    // and new result with new extension
    res = await ax.get(`/api/v1/datasets/${dataset.id}/lines?select=*`)
    assert.equal(res.data.total, 3)
    let existingResult = res.data.results.find(l => l.label === 'koumoul')
    assert.equal(existingResult[extensionKey + '.lat'], 10)
    assert.equal(existingResult[extensionKey + '.lon'], 10)
    assert.equal(existingResult._geopoint, '10,10')
    let newResult = res.data.results.find(l => l.label === 'me')
    assert.equal(newResult[extensionKey + '.lat'], 50)
    assert.equal(newResult[extensionKey + '.lon'], 50)
    assert.equal(newResult._geopoint, '50,50')

    // Re process full extension because of forceNext parameter
    nockScope = nock('http://test.com').post('/geocoder/coords').reply(200, (uri, requestBody) => {
      const inputs = requestBody.trim().split('\n').map(JSON.parse)
      assert.equal(inputs.length, 3)
      assert.deepEqual(Object.keys(inputs[0]), ['q', 'key'])
      return inputs.map(input => ({ key: input.key, lat: 40, lon: 40 }))
        .map(JSON.stringify).join('\n') + '\n'
    })
    res = await ax.patch(`/api/v1/datasets/${dataset.id}`, { extensions: [{ active: true, forceNext: true, remoteService: 'geocoder-koumoul', action: 'postCoords' }] })
    assert.equal(res.status, 200)
    await workers.hook(`finalizer/${dataset.id}`)
    nockScope.done()
    // A search to check re-indexed results with overwritten extensions
    res = await ax.get(`/api/v1/datasets/${dataset.id}/lines?select=*`)
    assert.equal(res.data.total, 3)
    existingResult = res.data.results.find(l => l.label === 'koumoul')
    assert.equal(existingResult[extensionKey + '.lat'], 40)
    assert.equal(existingResult[extensionKey + '.lon'], 40)
    newResult = res.data.results.find(l => l.label === 'me')
    assert.equal(newResult[extensionKey + '.lat'], 40)
    assert.equal(newResult[extensionKey + '.lon'], 40)
    assert.equal(newResult._geopoint, '40,40')
    dataset = (await ax.get(`/api/v1/datasets/${dataset.id}`)).data
    assert.equal(dataset.extensions[0].forceNext, false)
    assert.equal(dataset.extensions[0].progress, 1)

    // Reduce selected output using extension.select
    res = await ax.patch(`/api/v1/datasets/${dataset.id}`, { extensions: [{ active: true, remoteService: 'geocoder-koumoul', action: 'postCoords', select: ['lat', 'lon'] }] })
    assert.equal(res.status, 200)
    await workers.hook(`finalizer/${dataset.id}`)

    // Download extended file
    res = await ax.get(`/api/v1/datasets/${dataset.id}/full`)
    const lines = res.data.split('\n')
    assert.equal(lines[0], '\ufefflabel,adr,lat,lon')
    assert.equal(lines[1], 'koumoul,19 rue de la voie lactée saint avé,40,40')

    // list generated geo files
    res = await ax.get(`/api/v1/datasets/${dataset.id}/data-files`)
    assert.equal(res.status, 200)
    assert.equal(res.data.length, 2)
  })

  it('Manage errors during extension', async () => {
    const ax = global.ax.dmeadus

    // Initial dataset with addresses
    const form = new FormData()
    const content = `label,adr
koumoul,19 rue de la voie lactée saint avé
other,unknown address
`
    form.append('file', content, 'dataset2.csv')
    let res = await ax.post('/api/v1/datasets', form, { headers: testUtils.formHeaders(form) })
    assert.equal(res.status, 201)
    let dataset = await workers.hook(`finalizer/${res.data.id}`)
    dataset.schema.find(field => field.key === 'adr')['x-refersTo'] = 'http://schema.org/address'
    // Prepare for extension failure with HTTP error code
    nock('http://test.com').post('/geocoder/coords').reply(500, 'some error')
    res = await ax.patch(`/api/v1/datasets/${dataset.id}`, {
      schema: dataset.schema,
      extensions: [{ active: true, remoteService: 'geocoder-koumoul', action: 'postCoords' }],
    })
    assert.equal(res.status, 200)
    await workers.hook('finalizer')
    dataset = (await ax.get(`/api/v1/datasets/${dataset.id}`)).data
    assert.ok(dataset.extensions[0].error)

    // Prepare for extension failure with bad body in response
    nock('http://test.com').post('/geocoder/coords').reply(200, 'some error')
    res = await ax.patch(`/api/v1/datasets/${dataset.id}`, { extensions: [{ active: true, forceNext: true, remoteService: 'geocoder-koumoul', action: 'postCoords' }] })
    assert.equal(res.status, 200)
    await workers.hook('finalizer')
    dataset = (await ax.get('/api/v1/datasets/dataset2')).data
    assert.ok(dataset.extensions[0].error)
  })

  it('Manage empty queries', async () => {
    const ax = global.ax.dmeadus

    // Initial dataset with addresses
    const form = new FormData()
    const content = `label,adr
koumoul,19 rue de la voie lactée saint avé
empty,
`
    form.append('file', content, 'dataset3.csv')
    let res = await ax.post('/api/v1/datasets', form, { headers: testUtils.formHeaders(form) })
    assert.equal(res.status, 201)
    const dataset = await workers.hook(`finalizer/${res.data.id}`)

    // Prepare for extension failure with HTTP error code
    nock('http://test.com', { reqheaders: { 'x-apiKey': 'test_default_key' } })
      .post('/geocoder/coords').reply(200, (uri, requestBody) => {
        const inputs = requestBody.trim().split('\n').map(JSON.parse)
        assert.equal(inputs.length, 1)
        return inputs.map(input => ({ key: input.key, lat: 10, lon: 10 }))
          .map(JSON.stringify).join('\n') + '\n'
      })

    dataset.schema.find(field => field.key === 'adr')['x-refersTo'] = 'http://schema.org/address'
    res = await ax.patch(`/api/v1/datasets/${dataset.id}`, {
      schema: dataset.schema,
      extensions: [{ active: true, remoteService: 'geocoder-koumoul', action: 'postCoords' }],
    })
    assert.equal(res.status, 200)
    await workers.hook('finalizer')
  })
})
