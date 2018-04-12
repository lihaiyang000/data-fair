// A module of the store for the currently worked on dataset
// Used in the dataset vue and all its tabs and their components
import Vue from 'vue'
import eventBus from '../event-bus.js'

export default {
  namespaced: true,
  state: {
    datasetId: null,
    dataset: null,
    api: null,
    journal: [],
    remoteServices: []
  },
  getters: {
    resourceUrl: (state, getters, rootState) => state.datasetId ? rootState.env.publicUrl + '/api/v1/datasets/' + state.datasetId : null,
    concepts: state => new Set(state.dataset.schema.map(field => field['x-refersTo']).filter(c => c)),
    remoteServicesMap: (state, getters) => {
      const res = {}
      state.remoteServices.forEach(service => {
        service = Object.assign({}, service)
        service.actions = service.actions
          .filter(a => a.inputCollection && a.outputCollection)
          .filter(a => a.input.find(i => getters.concepts.has(i.concept)))
          .reduce((a, b) => { a[b.id] = b; return a }, {})
        res[service.id] = service
      })
      return res
    },
    isOwner: (state) => {
      return state.dataset.userPermissions.isOwner
    }
  },
  mutations: {
    setAny(state, params) {
      Object.assign(state, params)
    },
    patch(state, patch) {
      Object.assign(state.dataset, patch)
    },
    addJournalEvent(state, event) {
      if (!state.journal.find(e => e.date === event.date)) {
        state.journal.unshift(event)
      }
    },
    addRemoteService(state, service) {
      state.remoteServices.push(service)
    }
  },
  actions: {
    async fetchInfo({commit, getters}) {
      const dataset = await this.$axios.$get(getters.resourceUrl)
      const extensions = (dataset.extensions || []).map(ext => {
        ext.error = ext.error || ''
        ext.progress = ext.progress || 0
        ext.select = ext.select || []
        return ext
      })
      Vue.set(dataset, 'extensions', extensions)
      Vue.set(dataset, 'schema', dataset.schema || [])
      commit('setAny', {dataset})
      const api = await this.$axios.$get(getters.resourceUrl + '/api-docs.json')
      commit('setAny', {api})
    },
    async setId({commit, getters, dispatch, state}, datasetId) {
      commit('setAny', {datasetId})
      dispatch('fetchInfo')

      const newChannel = 'datasets/' + datasetId + '/journal'
      eventBus.$emit('subscribe', newChannel)
      eventBus.$on(newChannel, event => {
        if (event.type === 'finalize-end') {
          dispatch('notify', 'Le jeu de données a été traité en fonction de vos dernières modifications et est prêt à être utilisé ou édité de nouveau.', {root: true})
          dispatch('fetchInfo')
        }
        if (event.type === 'error') dispatch('notifyError', 'Le service a rencontré une erreur pendant le traitement du jeu de données: ' + event.data, {root: true})
        dispatch('addJournalEvent', event)
      })
    },
    clear({commit, state}) {
      if (state.datasetId) eventBus.$emit('unsubscribe', 'datasets/' + state.datasetId + '/journal')
      commit('setAny', {datasetId: null, dataset: null, api: null, journal: []})
    },
    async patch({commit, getters, dispatch}, patch) {
      try {
        const silent = patch.silent
        delete patch.silent
        await this.$axios.patch(getters.resourceUrl, patch)
        if (!silent) dispatch('notify', 'Le jeu de données a bien été mis à jour.', {root: true})
        return true
      } catch (error) {
        if (error.status === 409) {
          dispatch('notifyError', `Le jeu de données est en cours de traitement et votre modification n'a pas pu être appliquée. Veuillez essayer de nouveau un peu plus tard.`, {root: true})
        } else {
          dispatch('notifyError', `Erreur ${error.status || error.message} pendant la mise à jour du jeu de données`, {root: true})
        }
        return false
      }
    },
    async patchAndCommit({commit, getters, dispatch}, patch) {
      const patched = await dispatch('patch', patch)
      if (patched) commit('patch', patch)
    },
    async remove({state, getters, dispatch}) {
      try {
        await this.$axios.delete(getters.resourceUrl)
        dispatch('notify', `Le jeu de données ${state.dataset.title} a bien été supprimé`, {root: true})
      } catch (error) {
        dispatch('notifyError', `Erreur ${error.status || error.message} pendant la suppression du jeu de données ${state.dataset.title}`, {root: true})
      }
    },
    async fetchJournal({getters, commit}) {
      const journal = await this.$axios.$get(getters.resourceUrl + '/journal')
      commit('setAny', {journal})
    },
    addJournalEvent({commit}, event) {
      commit('addJournalEvent', event)
    },
    async fetchRemoteService({commit, getters, state}, id) {
      if (getters.remoteServicesMap[id]) return
      const remoteService = await this.$axios.$get('api/v1/remote-services/' + id)
      commit('addRemoteService', remoteService)
    },
    async fetchRemoteServices({getters, commit, state}) {
      let remoteServices = []
      if (getters.concepts.size) {
        const inputConcepts = [...getters.concepts].filter(c => c !== 'http://schema.org/identifier').map(encodeURIComponent).join(',')
        const data = await this.$axios.$get('api/v1/remote-services?input-concepts=' + inputConcepts)
        remoteServices = data.results.filter(s => s.owner.type === state.dataset.owner.type && s.owner.id === state.dataset.owner.id)
      }
      commit('setAny', {remoteServices})
    }
  }
}