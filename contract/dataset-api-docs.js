const config = require('config')
const datasetSchema = require('./dataset.json')
const version = require('../package.json').version

module.exports = (dataset) => {
  const properties = Object.keys(dataset.schema)
  const nonTextProperties = properties.filter(p => dataset.schema[p].type !== 'string' || dataset.schema[p].format)

  return {
    openapi: '3.0.0',
    info: Object.assign({
      title: `Dataset ${dataset.title || dataset.id} - API`,
      version: version
    }, config.info),
    servers: [{
      url: `${config.publicUrl}/api/v1/datasets/${dataset.id}`
    }],
    paths: {
      '/': {
        get: {
          summary: 'Récupérer les informations du jeu de données.',
          operationId: 'getInfo',
          responses: {
            200: {
              description: 'Les informations du jeu de données.',
              content: {
                'application/json': {
                  schema: datasetSchema
                }
              }
            }
          }
        }
      },
      '/lines': {
        get: {
          summary: 'Requêter les lignes du jeu de données.',
          operationId: 'search',
          parameters: [{ in: 'query',
            name: 'q',
            description: `
Champ de recherche simple. Ce paramètre peut-être utilisé pour exposer une fonctionalité de recherche textuelle riche aux utilisateurs sans risque de créer des erreurs de syntaxe.

Exemple: "open data" | "open source"

Pour plus d'information voir la documentation [ElasticSearch](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-simple-query-string-query.html) correspondante.
            `,
            required: false,
            schema: {
              type: 'string'
            }
          }, { in: 'query',
            name: 'page',
            description: 'Le numéro de la page (indice de la pagination). Débute à 1',
            required: false,
            schema: {
              default: 1,
              type: 'integer'
            }
          }, { in: 'query',
            name: 'size',
            description: 'Le nombre de résultats à retourner (taille de la pagination). 20 par défaut.',
            required: false,
            schema: {
              default: 20,
              type: 'integer',
              max: 10000
            }
          }, { in: 'query',
            name: 'select',
            description: 'La liste des champs à retourner',
            required: false,
            schema: {
              default: ['*'],
              type: 'array',
              items: {
                type: 'string',
                enum: properties
              }
            },
            style: 'commaDelimited'
          }, { in: 'query',
            name: 'sort',
            description: `
Le tri à effectuer sous forme d'une liste de clés de champs séparées par des virgules.

Par défaut le tri est ascendant, si un nom de champ est préfixé par un "-" alors le tri sera descendant.

Exemple: ma_colonne,-ma_colonne2`,
            required: false,
            default: [],
            schema: {
              type: 'array',
              items: {
                type: 'string',
                enum: nonTextProperties
              }
            },
            style: 'commaDelimited'
          }, { in: 'query',
            name: 'qs',
            description: `
Champ de filtre et recherche textuelle avancé. Ce paramètre permet d'effectuer des requêtes complexes sur la source de données. Vous pouvez spécifier des filtres par champs, créer des combinaisons logiques à volonté, etc.

Exemple: ma_colonne:"du texte" AND ma_colonne2:valeur

Pour plus d'information voir la documentation [ElasticSearch](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-query-string-query.html) correspondante.
      `,
            required: false,
            schema: {
              type: 'string'
            }
          }],
          responses: {
            200: {
              description: 'Le résultat de la requête.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      total: {
                        type: 'integer',
                        description: 'Le nombre total de résultat si on ignore la pagination'
                      },
                      results: {
                        type: 'array',
                        description: 'Le tableau de résultats.',
                        items: {
                          type: 'object',
                          properties: dataset.schema
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}