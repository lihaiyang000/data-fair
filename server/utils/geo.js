const turf = require('turf')
const rewind = require('@turf/rewind').default
const cleanCoords = require('@turf/clean-coords').default
const flatten = require('flat')

const geomUri = 'https://purl.org/geojson/vocab#geometry'
const latlonUri = 'http://www.w3.org/2003/01/geo/wgs84_pos#lat_long'
const latUri = ['http://schema.org/latitude', 'http://www.w3.org/2003/01/geo/wgs84_pos#lat']
const lonUri = ['http://schema.org/longitude', 'http://www.w3.org/2003/01/geo/wgs84_pos#long']

exports.schemaHasGeopoint = (schema) => {
  if (schema.find(p => p['x-refersTo'] === latlonUri)) return true
  if (schema.find(p => latUri.indexOf(p['x-refersTo']) !== -1) && schema.find(p => lonUri.indexOf(p['x-refersTo']) !== -1)) return true
  return false
}

exports.schemaHasGeometry = (schema) => {
  return !!schema.find(p => p['x-refersTo'] === geomUri)
}

exports.latlon2fields = (schema, doc) => {
  let lat, lon
  const latlonProp = schema.find(p => p['x-refersTo'] === latlonUri)
  if (latlonProp && doc[latlonProp.key]) [lat, lon] = doc[latlonProp.key].split(',')

  const latProp = schema.find(p => latUri.indexOf(p['x-refersTo']) !== -1)
  const lonProp = schema.find(p => lonUri.indexOf(p['x-refersTo']) !== -1)
  if (latProp && lonProp && doc[latProp.key] !== undefined && doc[lonProp.key] !== undefined) {
    lat = doc[latProp.key]
    lon = doc[lonProp.key]
  }

  if (!lat || !lon) return {}
  return {
    _geopoint: lat + ',' + lon,
    _geoshape: {type: 'Point', coordinates: [Number(lon), Number(lat)]},
    _geocorners: [lat + ',' + lon]
  }
}

exports.geometry2fields = (schema, doc) => {
  const prop = schema.find(p => p['x-refersTo'] === geomUri)
  if (!prop || !doc[prop.key] || doc[prop.key] === '{}') return {}
  const feature = {type: 'Feature', geometry: JSON.parse(doc[prop.key])}
  // Do the best we can to fix invalid geojson
  try {
    cleanCoords(feature, {mutate: true})
  } catch (err) {
    console.error('Failure while applying cleanCoords to geojson', err)
  }
  try {
    rewind(feature, {mutate: true})
  } catch (err) {
    console.error('Failure while applying rewind to geojson', err)
  }

  // check if simplify is a good idea ? too CPU intensive for our backend ?
  // const simplified = turf.simplify({type: 'Feature', geometry: JSON.parse(doc[prop.key])}, {tolerance: 0.01, highQuality: false})

  const centroid = turf.centroid(feature)
  const bboxPolygon = turf.bboxPolygon(turf.bbox(feature))
  return {
    _geopoint: centroid.geometry.coordinates[1] + ',' + centroid.geometry.coordinates[0],
    _geoshape: feature.geometry,
    _geocorners: bboxPolygon.geometry.coordinates[0].map(c => c[1] + ',' + c[0])
  }
}

exports.result2geojson = esResponse => {
  return {
    type: 'FeatureCollection',
    total: esResponse.hits.total,
    features: esResponse.hits.hits.map(hit => {
      const {_geoshape, ...properties} = hit._source
      return {
        type: 'Feature',
        geometry: hit._source._geoshape,
        properties: flatten(properties)
      }
    })
  }
}
