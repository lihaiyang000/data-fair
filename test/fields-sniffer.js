const sniffer = require('../server/utils/fields-sniffer')

const test = require('ava')

test('Work with booleans', t => {
  t.is(sniffer.sniff(['true', 'false']).type, 'boolean')
  t.is(sniffer.sniff(['true', 'False', '1', '-1']).type, 'boolean')
  t.is(sniffer.sniff(['true', '']).type, 'boolean')
  t.is(sniffer.sniff(['true', 'yes it is']).type, 'string')
  t.is(sniffer.format('True', {type: 'boolean'}), true)
  t.is(sniffer.format('1', {type: 'boolean'}), true)
  t.is(sniffer.format('-1', {type: 'boolean'}), false)
})

test('Work with numbers', t => {
  t.is(sniffer.sniff(['1.1', '2.2']).type, 'number')
  t.is(sniffer.sniff(['1', '22']).type, 'integer')
  t.is(sniffer.sniff(['111', '-2.2']).type, 'number')
  t.is(sniffer.format('-11', {type: 'number'}), -11)
  t.is(sniffer.format('-1', {type: 'integer'}), -1)
})

test('Work with dates', t => {
  t.deepEqual(sniffer.sniff(['2017-11-29', '2017-12-12']), {type: 'string', format: 'date'})
  t.deepEqual(sniffer.sniff(['2017-11-29T12:24:36.816Z']), {type: 'string', format: 'date-time'})
})

test('Work with keywords and texts', t => {
  t.deepEqual(sniffer.sniff(['id1', 'id2']), {type: 'string', format: 'uri-reference'})
  t.deepEqual(sniffer.sniff(['id1', 'a text with whitespaces']), {type: 'string'})
})