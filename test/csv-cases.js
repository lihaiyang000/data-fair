// Some edge cases with CSV files
const assert = require('assert').strict
const testUtils = require('./resources/test-utils')

describe('CSV cases', () => {
  it('Process newly uploaded CSV dataset', async () => {
    const ax = global.ax.dmeadus
    const dataset = await testUtils.sendDataset('2018-08-30_Type_qualificatif.csv', ax)
    assert.equal(dataset.status, 'finalized')
    const res = await ax.get(`/api/v1/datasets/${dataset.id}/lines`)
    assert.equal(res.data.total, 3)
  })

  it('A CSV with weird keys', async () => {
    const ax = global.ax.dmeadus
    const dataset = await testUtils.sendDataset('weird-keys.csv', ax)
    assert.equal(dataset.status, 'finalized')
    assert.equal(dataset.schema[0].key, 'This_key_has_escaped_quotes_in_it')
    assert.equal(dataset.schema[0]['x-originalName'], 'This key has "escaped quotes" in it')
    const res = await ax.get(`/api/v1/datasets/${dataset.id}/lines`)
    assert.equal(res.data.total, 1)
  })

  it('A CSV with splitting errors', async () => {
    const ax = global.ax.dmeadus
    const dataset = await testUtils.sendDataset('dataset-split-fail.csv', ax)
    assert.equal(dataset.status, 'finalized')
    const res = await ax.get(`/api/v1/datasets/${dataset.id}/lines`)
    assert.equal(res.data.total, 20)
  })

  it('A CSV with quotes on data line, but not on header line', async () => {
    const ax = global.ax.dmeadus
    const dataset = await testUtils.sendDataset('some-quotes.csv', ax)
    assert.equal(dataset.status, 'finalized')
    const res = await ax.get(`/api/v1/datasets/${dataset.id}/lines`)
    assert.equal(res.data.total, 1)
    assert.equal(res.data.results[0].Code_departement, 56)
  })

  it('A CSV with formatting issues', async () => {
    const ax = global.ax.dmeadus
    const dataset = await testUtils.sendDataset('formatting-issues.csv', ax)
    assert.equal(dataset.status, 'finalized')
    const res = await ax.get(`/api/v1/datasets/${dataset.id}/lines`)
    assert.equal(res.data.total, 12)
    assert.equal(res.data.results[0].Structure_porteuse, 'Struct1')
  })
})
