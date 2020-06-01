<template lang="html">
  <v-row>
    <v-col
      cols="12"
      md="6"
      order-md="2"
    >
      <v-sheet>
        <v-list dense>
          <owner-list-item :owner="dataset.owner" />

          <v-list-item
            v-if="journal[0]"
            :class="'event-' + journal[0].type"
          >
            <v-list-item-avatar v-if="['finalize-end', 'error', 'publication'].includes(journal[0].type)" class="ml-0 my-0">
              <v-icon>{{ events[journal[0].type].icon }}</v-icon>
            </v-list-item-avatar>
            <v-list-item-avatar v-else>
              <v-progress-circular
                :size="20"
                :width="3"
                small
                indeterminate
                color="primary"
              />
            </v-list-item-avatar>
            <div v-if="journal[0].type === 'error'">
              <p>{{ events[journal[0].type] && events[journal[0].type].text }}</p>
              <p v-html="journal[0].data" />
            </div>
            <span v-else>{{ events[journal[0].type] && events[journal[0].type].text }}</span>
            <v-spacer />
            <v-list-item-action v-if="journal[0].type === 'error' && can('writeDescription')">
              <v-btn
                v-if="user.adminMode"
                icon
                title="Reindexer en tant que super admin"
                @click="reindex({})"
              >
                <v-icon>mdi-play</v-icon>
              </v-btn>
              <v-btn
                v-else
                icon
                title="Relancer"
                @click="patch({})"
              >
                <v-icon>mdi-play</v-icon>
              </v-btn>
            </v-list-item-action>
          </v-list-item>

          <v-list-item v-if="dataset.file">
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>mdi-file</v-icon>
            </v-list-item-avatar>
            <span>{{ (dataset.remoteFile || dataset.originalFile || dataset.file).name }} {{ ((dataset.remoteFile || dataset.originalFile || dataset.file).size / 1000).toFixed(2) }} ko</span>
          </v-list-item>

          <v-list-item>
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>mdi-pencil</v-icon>
            </v-list-item-avatar>
            <span>{{ dataset.updatedBy.name }} {{ dataset.updatedAt | moment("DD/MM/YYYY, HH:mm") }}</span>
          </v-list-item>

          <v-list-item>
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>mdi-plus-circle-outline</v-icon>
            </v-list-item-avatar>
            <span>{{ dataset.createdBy.name }} {{ dataset.createdAt | moment("DD/MM/YYYY, HH:mm") }}</span>
          </v-list-item>

          <v-list-item v-if="dataset.count !== undefined">
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>mdi-view-headline</v-icon>
            </v-list-item-avatar>
            <span>{{ dataset.count }} enregistrements</span>
          </v-list-item>

          <v-list-item>
            <v-list-item-avatar v-if="nbApplications === null" class="ml-0 my-0">
              <v-progress-circular
                :size="20"
                :width="3"
                small
                indeterminate
                color="primary"
              />
            </v-list-item-avatar>
            <template v-else>
              <v-list-item-avatar class="ml-0 my-0">
                <v-icon>mdi-apps</v-icon>
              </v-list-item-avatar>
              <span v-if="nbApplications === 0">0 application</span>
              <nuxt-link
                v-else
                :to="`/applications?dataset=${dataset.id}`"
              >
                {{ nbApplications }} application{{ nbApplications > 1 ? 's' : '' }}
              </nuxt-link>
            </template>
          </v-list-item>

          <v-list-item v-if="nbVirtualDatasets">
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>mdi-picture-in-picture-bottom-right-outline</v-icon>
            </v-list-item-avatar>
            <nuxt-link :to="`/datasets?children=${dataset.id}`">
              {{ nbVirtualDatasets }} jeu{{ nbVirtualDatasets > 1 ? 'x' : '' }} de données virtuel{{ nbVirtualDatasets > 1 ? 's' : '' }}
            </nuxt-link>
          </v-list-item>

          <v-list-item v-if="dataset.isRest">
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>mdi-all-inclusive</v-icon>
            </v-list-item-avatar>
            <span>Jeu de données incrémental</span>
          </v-list-item>
        </v-list>
      </v-sheet>
    </v-col>
    <v-col
      cols="12"
      md="6"
      order-md="1"
    >
      <v-text-field
        v-model="dataset.title"
        :disabled="!can('writeDescription')"
        label="Titre"
        dense
        @change="patch({title: dataset.title})"
      />
      <v-textarea
        v-model="dataset.description"
        :disabled="!can('writeDescription')"
        label="Description"
        filled
        dense
        rows="4"
        @change="patch({description: dataset.description})"
      />
      <v-select
        v-model="dataset.license"
        :items="licenses"
        :disabled="!can('writeDescription')"
        item-text="title"
        item-key="href"
        label="Licence"
        dense
        return-object
        @input="patch({license: dataset.license})"
      />
      <v-select
        v-if="editProjection && projections"
        v-model="dataset.projection"
        :items="projections"
        :disabled="!can('writeDescription')"
        item-text="title"
        item-key="code"
        label="Projection cartographique"
        return-object
        dense
        @input="patch({projection: dataset.projection})"
      />
      <v-text-field
        v-model="dataset.origin"
        :disabled="!can('writeDescription')"
        label="Provenance"
        dense
        @change="patch({origin: dataset.origin})"
      />
    </v-col>
  </v-row>
</template>

<script>
  import OwnerListItem from '~/components/owners/list-item.vue'
  const { mapState, mapActions, mapGetters } = require('vuex')
  const events = require('~/../shared/events.json').dataset
  const coordXUri = 'http://data.ign.fr/def/geometrie#coordX'
  const coordYUri = 'http://data.ign.fr/def/geometrie#coordY'

  export default {
    components: {
      OwnerListItem,
    },
    data() {
      return { events, error: null }
    },
    computed: {
      ...mapState(['projections']),
      ...mapState('dataset', ['dataset', 'journal', 'nbApplications', 'nbVirtualDatasets']),
      ...mapState('session', ['user']),
      ...mapGetters('dataset', ['can', 'resourceUrl']),
      licenses() {
        return this.$store.getters.ownerLicenses(this.dataset.owner)
      },
      editProjection() {
        return !!(this.dataset && this.dataset.schema &&
          this.dataset.schema.find(p => p['x-refersTo'] === coordXUri) &&
          this.dataset.schema.find(p => p['x-refersTo'] === coordYUri))
      },
    },
    watch: {
      licenses() {
        if (!this.dataset.license) return
        // Matching object reference, so that the select components works
        this.dataset.license = this.licenses.find(l => l.href === this.dataset.license.href)
      },
      projections() {
        if (!this.dataset.projection) return
        // Matching object reference, so that the select components works
        this.dataset.projection = this.projections.find(l => l.code === this.dataset.projection.code)
      },
    },
    async mounted() {
      if (this.dataset) this.$store.dispatch('fetchLicenses', this.dataset.owner)
      if (this.editProjection) this.$store.dispatch('fetchProjections')

      // Ping the data endpoint to check that index is available
      try {
        this.data = await this.$axios.$get(this.resourceUrl + '/lines', { size: 0 })
      } catch (err) {
      // Do nothing, error should be added to the journal
      }
    },
    methods: {
      ...mapActions('dataset', ['patch', 'reindex']),
    },
  }
</script>

<style lang="css">
</style>