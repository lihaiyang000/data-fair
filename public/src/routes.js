import Vue from 'vue'

import Home from './pages/Home.vue'
import Datasets from './pages/Datasets.vue'
import Dataset from './pages/Dataset.vue'
import RemoteServices from './pages/RemoteServices.vue'
import RemoteService from './pages/RemoteService.vue'
import ApplicationConfigs from './pages/ApplicationConfigs.vue'
import ApplicationConfig from './pages/ApplicationConfig.vue'
import Settings from './pages/Settings.vue'
import ApiDoc from './ApiDoc.vue'

export default [{
  path: '/',
  name: 'Home',
  component: Home
}, {
  path: '/datasets',
  name: 'Datasets',
  component: Datasets
}, {
  path: '/dataset/:datasetId',
  name: 'Dataset',
  component: Dataset
}, {
  path: '/remote-services',
  name: 'RemoteServices',
  component: RemoteServices
}, {
  path: '/remote-service/:remoteServiceId',
  name: 'RemoteService',
  component: RemoteService
}, {
  path: '/application-configs',
  name: 'ApplicationConfigs',
  component: ApplicationConfigs
}, {
  path: '/application-config/:applicationConfigId',
  name: 'ApplicationConfig',
  component: ApplicationConfig
}, {
  path: '/settings/:type/:id',
  name: 'Settings',
  component: Settings
}, {
  path: '/api-doc',
  name: 'ApiDoc',
  component: ApiDoc
}, {
  path: '/signin',
  name: 'Signin',
  redirect: to => {
    Vue.cookie.set('id_token', to.query.id_token, 30)
    return {
      path: '/',
      query: null
    }
  }
}]
