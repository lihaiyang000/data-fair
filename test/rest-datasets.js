const fs = require('fs-extra')
const FormData = require('form-data')
const moment = require('moment')
const assert = require('assert').strict
const testUtils = require('./resources/test-utils')

const restDatasetsUtils = require('../server/utils/rest-datasets')
const datasetUtils = require('../server/utils/dataset')
const workers = require('../server/workers')

describe('REST datasets', () => {
  it('Create empty REST datasets', async () => {
    const ax = global.ax.dmeadus
    let res = await ax.post('/api/v1/datasets', { isRest: true, title: 'a rest dataset' })
    assert.equal(res.status, 201)
    assert.equal(res.data.id, 'a-rest-dataset')

    res = await ax.post('/api/v1/datasets', { isRest: true, title: 'a rest dataset' })
    assert.equal(res.status, 201)
    assert.equal(res.data.id, 'a-rest-dataset-2')

    res = await ax.put('/api/v1/datasets/restdataset3', { isRest: true, title: 'a rest dataset' })
    assert.equal(res.status, 201)
    assert.equal(res.data.id, 'restdataset3')
  })

  it('Perform CRUD operations on REST datasets', async () => {
    const ax = global.ax.dmeadus
    let res = await ax.post('/api/v1/datasets', {
      isRest: true,
      title: 'rest1',
      schema: [{ key: 'attr1', type: 'string' }, { key: 'attr2', type: 'string' }],
    })
    res = await ax.post('/api/v1/datasets/rest1/lines', { attr1: 'test1', attr2: 'test1' })
    assert.equal(res.status, 201)
    assert.ok(res.data._id)
    assert.equal(res.data.attr1, 'test1')
    res = await ax.post('/api/v1/datasets/rest1/lines', { _id: 'id1', attr1: 'test1', attr2: 'test1' })
    assert.equal(res.data._id, 'id1')
    res = await ax.get('/api/v1/datasets/rest1/lines/id1')
    assert.equal(res.data._id, 'id1')
    assert.equal(res.data.attr1, 'test1')
    await ax.put('/api/v1/datasets/rest1/lines/id1', { attr1: 'test2', attr2: 'test2' })
    res = await ax.get('/api/v1/datasets/rest1/lines/id1')
    assert.equal(res.data._id, 'id1')
    assert.equal(res.data.attr1, 'test2')
    await ax.patch('/api/v1/datasets/rest1/lines/id1', { attr1: 'test3' })
    res = await ax.get('/api/v1/datasets/rest1/lines/id1')
    assert.equal(res.data._id, 'id1')
    assert.equal(res.data.attr1, 'test3')
    assert.equal(res.data.attr2, 'test2')
    await ax.delete('/api/v1/datasets/rest1/lines/id1')
    try {
      await ax.get('/api/v1/datasets/rest1/lines/id1')
      assert.fail()
    } catch (err) {
      assert.equal(err.status, 404)
    }
  })

  it('Perform CRUD operations in bulks', async () => {
    const ax = global.ax.dmeadus
    await ax.put('/api/v1/datasets/rest2', {
      isRest: true,
      title: 'rest2',
      schema: [{ key: 'attr1', type: 'string' }, { key: 'attr2', type: 'string' }],
    })
    await workers.hook('indexer/rest2')
    let res = await ax.post('/api/v1/datasets/rest2/_bulk_lines', [
      { attr1: 'test1', attr2: 'test1' },
      { _id: 'line2', attr1: 'test1', attr2: 'test1' },
      { _id: 'line3', attr1: 'test1', attr2: 'test1' },
      { _id: 'line4', attr1: 'test1', attr2: 'test1' },
      { _action: 'delete', _id: 'line2' },
      { _action: 'patch', _id: 'line3', attr1: 'test2' },
      { _action: 'update', _id: 'line4', attr1: 'test2', attr2: 'test2' },
    ])
    assert.equal(res.data.nbOk, 7)

    try {
      await ax.get('/api/v1/datasets/rest2/lines/line2')
      assert.fail()
    } catch (err) {
      assert.equal(err.status, 404)
    }
    res = await ax.get('/api/v1/datasets/rest2/lines/line3')
    assert.equal(res.data.attr1, 'test2')
    assert.equal(res.data.attr2, 'test1')
    res = await ax.get('/api/v1/datasets/rest2/lines/line4')
    assert.equal(res.data.attr1, 'test2')
    assert.equal(res.data.attr2, 'test2')
  })

  it('Index and finalize dataset after write', async function () {
    // Load a few lines
    const ax = global.ax.dmeadus
    await ax.put('/api/v1/datasets/rest3', {
      isRest: true,
      title: 'rest3',
      schema: [{ key: 'attr1', type: 'string' }, { key: 'attr2', type: 'string' }],
    })
    let dataset = await workers.hook('indexer/rest3')
    let res = await ax.post('/api/v1/datasets/rest3/_bulk_lines', [
      { _id: 'line1', attr1: 'test1', attr2: 'test1' },
      { _id: 'line2', attr1: 'test1', attr2: 'test1' },
      { _id: 'line3', attr1: 'test1', attr2: 'test1' },
      { _id: 'line4', attr1: 'test1', attr2: 'test1' },
    ])
    await workers.hook('indexer/rest3')
    dataset = await workers.hook('finalizer/rest3')
    assert.ok(dataset.schema.find(f => f.key === '_id'))
    assert.ok(dataset.schema.find(f => f.key === '_updatedAt'))
    res = await ax.get('/api/v1/datasets/rest3/lines')
    assert.equal(res.data.total, 4)

    // Patch one through db query to check that it won't processed
    // we must be sure that the whole dataset is not reindexed each time, only the diffs
    const collection = restDatasetsUtils.collection(global.db, dataset)
    await collection.updateOne({ _id: 'line4' }, { $set: { attr2: 'altered' } })
    assert.equal((await collection.findOne({ _id: 'line4' })).attr2, 'altered')

    res = await ax.post('/api/v1/datasets/rest3/_bulk_lines', [
      { _action: 'delete', _id: 'line1' },
      { _action: 'patch', _id: 'line2', attr1: 'test2' },
    ])
    assert.equal(await collection.countDocuments({ _needsIndexing: true }), 2)

    dataset = await workers.hook('finalizer/rest3')
    assert.equal(await collection.countDocuments({ _needsIndexing: true }), 0)
    assert.equal(dataset.count, 3)
    res = await ax.get('/api/v1/datasets/rest3/lines')
    assert.equal(res.data.total, 3)
    const line4 = res.data.results.find(r => r._id === 'line4')
    assert.equal(line4.attr2, 'test1')
  })

  it('Use dataset schema to validate inputs', async () => {
    const ax = global.ax.dmeadus
    await ax.put('/api/v1/datasets/rest4', {
      isRest: true,
      title: 'rest4',
      schema: [{ key: 'attr1', type: 'string' }, { key: 'attr2', type: 'string' }],
    })
    await workers.hook('indexer/rest4')
    try {
      await ax.post('/api/v1/datasets/rest4/lines', { attr3: 'test1' })
      assert.fail()
    } catch (err) {
      assert.equal(err.status, 400)
    }

    try {
      await ax.post('/api/v1/datasets/rest4/lines', { attr1: 111 })
      assert.fail()
    } catch (err) {
      assert.equal(err.status, 400)
    }

    try {
      await ax.put('/api/v1/datasets/rest4/lines/line1', { attr1: 111 })
      assert.fail()
    } catch (err) {
      assert.equal(err.status, 400)
    }

    try {
      await ax.patch('/api/v1/datasets/rest4/lines/line1', { attr1: 111 })
      assert.fail()
    } catch (err) {
      assert.equal(err.status, 400)
    }

    const res = await ax.post('/api/v1/datasets/rest4/_bulk_lines', [
      { _id: 'line1', attr1: 'test' },
      { _id: 'line1', attr1: 111 },
    ])

    assert.equal(res.data.nbOk, 1)
    assert.equal(res.data.nbErrors, 1)
    assert.equal(res.data.errors.length, 1)
    assert.equal(res.data.errors[0].line, 1)
    assert.ok(res.data.errors[0].error)
  })

  it('Send attachment with multipart request', async function() {
    const ax = global.ax.dmeadus
    let res = await ax.post('/api/v1/datasets', {
      isRest: true,
      title: 'rest5',
      schema: [
        { key: 'attr1', type: 'integer' },
        { key: 'attachmentPath', type: 'string', 'x-refersTo': 'http://schema.org/DigitalDocument' },
      ],
    })
    const dataset = res.data
    await workers.hook('finalizer/rest5')

    // Create a line with an attached file
    const form = new FormData()
    const attachmentContent = fs.readFileSync('./test/resources/files/dir1/test.pdf')
    form.append('attachment', attachmentContent, 'dir1/test.pdf')
    form.append('attr1', 10)
    res = await ax.post('/api/v1/datasets/rest5/lines', form, { headers: testUtils.formHeaders(form) })
    assert.equal(res.status, 201)
    assert.ok(res.data._id)
    assert.equal(res.data.attachmentPath, `${res.data._id}/test.pdf`)
    const ls = await datasetUtils.lsAttachments(dataset)
    assert.equal(ls.length, 1)
    assert.equal(ls[0], res.data.attachmentPath)

    await workers.hook('finalizer/rest5')
    res = await ax.get('/api/v1/datasets/rest5/lines')
    assert.equal(res.data.total, 1)
    assert.equal(res.data.results[0]['_file.content'], 'This is a test pdf file.')
  })

  it('Send attachments with bulk request', async () => {
    const ax = await global.ax.ngernier4
    let res = await ax.post('/api/v1/datasets', {
      isRest: true,
      title: 'rest6',
      schema: [
        { key: 'attr1', type: 'string' },
        { key: 'attachmentPath', type: 'string', 'x-refersTo': 'http://schema.org/DigitalDocument' },
      ],
    })
    const dataset = res.data
    await workers.hook('finalizer/rest6')

    // Create a line with an attached file
    const form = new FormData()
    const attachmentsContent = fs.readFileSync('./test/resources/files.zip')
    form.append('attachments', attachmentsContent, 'files.zip')
    form.append('actions', Buffer.from(JSON.stringify([
      { _id: 'line1', attr1: 'test1', attachmentPath: 'test.odt' },
      { _id: 'line2', attr1: 'test1', attachmentPath: 'dir1/test.pdf' },
    ]), 'utf8'), 'actions.json')
    res = await ax.post('/api/v1/datasets/rest6/_bulk_lines', form, { headers: testUtils.formHeaders(form) })
    assert.equal(res.status, 200)
    assert.equal(res.data.nbOk, 2)
    const ls = await datasetUtils.lsAttachments(dataset)
    assert.equal(ls.length, 2)

    await workers.hook('finalizer/rest6')
    res = await ax.get('/api/v1/datasets/rest6/lines')
    assert.equal(res.data.total, 2)
    assert.equal(res.data.results.find(l => l._id === 'line1')['_file.content'], 'This is a test libreoffice file.')
  })

  it('Send bulk requests in ndjson file', async () => {
    const ax = await global.ax.ngernier4
    let res = await ax.post('/api/v1/datasets', {
      isRest: true,
      title: 'restndjson',
      schema: [
        { key: 'ip', type: 'string' },
        { key: 'date', type: 'string', format: 'date-time' },
        { key: 'bytes', type: 'number' },
        { key: 'method', type: 'string' },
        { key: 'protocol', type: 'string' },
        { key: 'status', type: 'string' },
        { key: 'referer', type: 'string' },
        { key: 'url', type: 'string', 'x-refersTo': 'https://schema.org/WebPage' },
        { key: 'lat', type: 'number', 'x-refersTo': 'http://schema.org/latitude' },
        { key: 'lon', type: 'number', 'x-refersTo': 'http://schema.org/longitude' },
        { key: 'browser', type: 'string' },
        { key: 'device', type: 'string' },
        { key: 'os', type: 'string' },
        { key: 'collection', type: 'string' },
        { key: 'resourceId', type: 'string' },
        { key: 'operation', type: 'string' },
      ],
    })
    await workers.hook('finalizer/restndjson')

    // Create a line with an attached file
    const form = new FormData()
    form.append('actions', await fs.readFile('test/resources/access.log.ndjson'), 'actions.ndjson')
    res = await ax.post('/api/v1/datasets/restndjson/_bulk_lines', form, { headers: testUtils.formHeaders(form) })
    assert.equal(res.status, 200)
    assert.equal(res.data.nbErrors, 0)
    assert.equal(res.data.nbOk, 20)

    await workers.hook('finalizer/restndjson')
    res = await ax.get('/api/v1/datasets/restndjson/lines')
    assert.equal(res.data.total, 20)
  })

  it('Send bulk requests in ndjson file and receive errors', async () => {
    const ax = await global.ax.ngernier4
    await ax.post('/api/v1/datasets', {
      isRest: true,
      title: 'restndjson',
      schema: [
        { key: 'ip', type: 'string' },
        { key: 'date', type: 'string', format: 'date-time' },
      ],
    })
    await workers.hook('finalizer/restndjson')

    // Create a line with an attached file
    const form = new FormData()
    form.append('actions', await fs.readFile('test/resources/access.log.ndjson'), 'actions.ndjson')
    try {
      await ax.post('/api/v1/datasets/restndjson/_bulk_lines', form, { headers: testUtils.formHeaders(form) })
      assert.fail()
    } catch (err) {
      assert.equal(err.status, 400)
      assert.equal(err.data.nbErrors, 20)
      assert.equal(err.data.nbOk, 0)
    }
  })

  it('The size of the mongodb collection is part of storage consumption', async () => {
  // Load a few lines
    const ax = await global.ax.builder('ccherryholme1@icio.us:passwd')
    await ax.post('/api/v1/datasets', {
      isRest: true,
      title: 'rest7',
      schema: [{ key: 'attr1', type: 'string' }, { key: 'attr2', type: 'string' }],
    })
    await ax.post('/api/v1/datasets/rest7/_bulk_lines', [
      { _id: 'line1', attr1: 'test1', attr2: 'test1' },
      { _id: 'line2', attr1: 'test1', attr2: 'test1' },
      { _id: 'line3', attr1: 'test1', attr2: 'test1' },
      { _id: 'line4', attr1: 'test1', attr2: 'test1' },
    ])
    await workers.hook('finalizer/rest7')

    let res = await ax.get('/api/v1/stats')
    assert.equal(res.status, 200)
    assert.equal(res.data.user.storage, 684)
    res = await ax.get('/api/v1/datasets/rest7')
    assert.equal(res.data.storage.size, 684)
    assert.equal(res.data.storage.collectionSize, 684)
  })

  it('Activate the history mode', async () => {
    const ax = await global.ax.hlalonde3
    let res = await ax.post('/api/v1/datasets', {
      isRest: true,
      title: 'resthist',
      rest: { history: true },
      schema: [{ key: 'attr1', type: 'string' }, { key: 'attr2', type: 'string' }],
    })
    res = await ax.post('/api/v1/datasets/resthist/lines', { _id: 'id1', attr1: 'test1', attr2: 'test1' })
    assert.equal(res.data._id, 'id1')
    res = await ax.patch('/api/v1/datasets/resthist/lines/id1', { attr1: 'test2' })
    await workers.hook('finalizer/resthist')
    res = await ax.get('/api/v1/datasets/resthist/lines/id1/revisions')
    assert.equal(res.data.results[0]._id, 'id1')
    assert.equal(res.data.results[0].attr1, 'test2')
    assert.equal(res.data.results[1]._id, 'id1')
    assert.equal(res.data.results[1].attr1, 'test1')

    res = await ax.get('/api/v1/stats')
    assert.equal(res.data.user.storage, 478)
    res = await ax.get('/api/v1/datasets/resthist')
    assert.equal(res.data.storage.size, 478)
    assert.equal(res.data.storage.collectionSize, 164)
    assert.equal(res.data.storage.revisionsSize, 314)
  })

  it('Apply a TTL on some date-field', async () => {
    const ax = await global.ax.hlalonde3
    await ax.post('/api/v1/datasets', {
      isRest: true,
      title: 'restttl',
      rest: {
        ttl: {
          active: true,
          prop: 'attr2',
          delay: {
            value: 1,
            unit: 'days',
          },
        },
       },
      schema: [{ key: 'attr1', type: 'string' }, { key: 'attr2', type: 'string', format: 'date-time' }],
    })
    await workers.hook('finalizer/restttl')
    await ax.post('/api/v1/datasets/restttl/lines', { attr1: 'test1', attr2: moment().subtract(3, 'days').toISOString() })
    await ax.post('/api/v1/datasets/restttl/lines', { attr1: 'test1', attr2: moment().subtract(2, 'days').toISOString() })
    await ax.post('/api/v1/datasets/restttl/lines', { attr1: 'test1', attr2: moment().subtract(1, 'days').toISOString() })
    await ax.post('/api/v1/datasets/restttl/lines', { attr1: 'test1', attr2: moment().subtract(1, 'hours').toISOString() })
    await workers.hook('finalizer/restttl')
    let res = await ax.get('/api/v1/datasets/restttl/lines')
    assert.equal(res.data.total, 4)
    await workers.hook('ttlManager/restttl')
    await workers.hook('finalizer/restttl')
    res = await ax.get('/api/v1/datasets/restttl/lines')
    assert.equal(res.data.total, 1)
  })
})
