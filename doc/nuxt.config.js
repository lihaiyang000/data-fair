const config = require('config')
const dir = require('node-dir')
const messages = require('../i18n').messages

// Additional dynamic routes for generate
const routes = dir.files('doc/pages/', { sync: true })
  .filter(f => f.endsWith('.md'))
  .map(f => {
    f = f.replace('.md', '').replace('doc/pages/', '')
    const dashInd = f.lastIndexOf('-')
    const key = f.slice(0, dashInd)
    const lang = f.slice(dashInd + 1, f.length)
    return lang === 'fr' ? `/${key}` : `/${lang}/${key}`
  })

module.exports = {
  srcDir: 'doc/',
  build: { extractCSS: true },
  generate: {
    dir: 'doc-dist',
    routes,
  },
  loading: { color: '#1e88e5' }, // Customize the progress bar color
  router: { base: '/data-fair/' },
  env: {
    theme: config.theme,
    publicUrl: config.publicUrl,
  },
  modules: ['@digibytes/markdownit', ['nuxt-i18n', {
    seo: false,
    locales: [
      { code: 'fr' },
      { code: 'en' },
    ],
    defaultLocale: 'fr',
    vueI18n: {
      fallbackLocale: 'fr',
      messages,
    },
  }]],
  buildModules: ['@nuxtjs/vuetify'],
  vuetify: {
    theme: {
      themes: {
        light: config.theme.colors,
      },
    },
    defaultAssets: {
      font: {
        family: 'Nunito',
      },
    },
  },
  head: {
    title: 'DataFair',
    meta: [
      { charset: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { hid: 'application', name: 'application-name', content: 'DataFair' },
      { hid: 'description', name: 'description', content: 'DataFair - Documentation' },
    ],
    link: [
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css?family=Nunito:300,400,500,700,400italic|Material+Icons' },
      { rel: 'icon', type: 'image/x-icon', href: 'favicon.ico' },
    ],
  },
}
