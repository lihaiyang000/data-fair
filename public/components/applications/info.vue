<template lang="html">
  <v-row>
    <v-col
      cols="12"
      md="6"
      lg="5"
      order-md="2"
    >
      <v-sheet style="background: transparent;">
        <v-list dense style="background: transparent;">
          <owner-list-item :owner="application.owner" />

          <v-list-item
            v-if="resourcePublicUrl"
            :href="resourcePublicUrl"
            color="primary"
          >
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>mdi-link</v-icon>
            </v-list-item-avatar>
            <a>Page de présentation</a>
          </v-list-item>

          <v-list-item>
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>mdi-file-image</v-icon>
            </v-list-item-avatar>
            <span>{{ prodBaseApp ? prodBaseApp.title : application.url.split('/').slice(-3,-2).pop() }}</span>
          </v-list-item>
          <v-list-item>
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>mdi-information-outline</v-icon>
            </v-list-item-avatar>
            <span>Version {{ version }}</span>
            <v-spacer />
            <span v-if="upgradeAvailable" class="accent--text">
              Version {{ upgradeAvailable.version }} disponible</span>
          </v-list-item>

          <!--<v-list-item
            v-if="journal[0]"
            :class="'event-' + journal[0].type"
          >
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>{{ events[journal[0].type].icon }}</v-icon>
            </v-list-item-avatar>
            <span>{{ events[journal[0].type].text }}</span>
          </v-list-item>-->
          <v-list-item>
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>mdi-pencil</v-icon>
            </v-list-item-avatar>
            <span>{{ application.updatedBy.name }} {{ application.updatedAt | moment("DD/MM/YYYY, HH:mm") }}</span>
          </v-list-item>
          <v-list-item>
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>mdi-plus-circle-outline</v-icon>
            </v-list-item-avatar>
            <span>{{ application.createdBy.name }} {{ application.createdAt | moment("DD/MM/YYYY, HH:mm") }}</span>
          </v-list-item>
          <v-list-item
            v-if="dataset"
            :to="`/dataset/${dataset.id}`"
          >
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>mdi-database</v-icon>
            </v-list-item-avatar>
            <a>{{ dataset.title }}</a>
          </v-list-item>
          <v-list-item v-if="nbSessions !== null">
            <v-list-item-avatar class="ml-0 my-0">
              <v-icon>mdi-eye</v-icon>
            </v-list-item-avatar>
            <span>{{ nbSessions }} {{ nbSessions > 1 ? 'sessions actives dans la dernière heure' : 'session active dans la dernière heure' }}</span>
          </v-list-item>
        </v-list>
      </v-sheet>
    </v-col>
    <v-col
      cols="12"
      md="6"
      lg="7"
      order-md="1"
    >
      <v-text-field
        v-model="application.title"
        :disabled="!can('writeDescription')"
        label="Titre"
        dense
        @change="patch({title: application.title})"
      />
      <v-textarea
        v-model="application.description"
        :disabled="!can('writeDescription')"
        label="Description"
        filled
        dense
        rows="4"
        @change="patch({description: application.description})"
      />
      <v-select
        v-if="topics && topics.length"
        v-model="application.topics"
        :disabled="!can('writeDescription')"
        :items="topics"
        item-text="title"
        item-key="id"
        label="Thématiques"
        multiple
        dense
        return-object
        @input="patch({topics: application.topics})"
      />
    </v-col>
  </v-row>
</template>

<script>
  import OwnerListItem from '~/components/owners/list-item.vue'
  import { mapState, mapActions, mapGetters } from 'vuex'
  const events = require('~/../shared/events.json').application

  export default {
    components: { OwnerListItem },
    data() {
      return { events }
    },
    computed: {
      ...mapState('application', ['application', 'nbSessions', 'journal', 'prodBaseApp']),
      ...mapGetters('application', ['can', 'resourcePublicUrl', 'availableVersions']),
      topics() {
        return this.$store.getters.ownerTopics(this.application.owner)
      },
      dataset() {
        let dataset
        if (this.application.configuration && this.application.configuration.datasets && this.application.configuration.datasets.length) {
          dataset = JSON.parse(JSON.stringify(this.application.configuration.datasets[0]))
        } else if (this.application.configurationDraft && this.application.configurationDraft.datasets && this.application.configurationDraft.datasets.length) {
          dataset = JSON.parse(JSON.stringify(this.application.configurationDraft.datasets[0]))
        }
        if (dataset && !dataset.id) {
          dataset.id = dataset.href.split('/').pop()
        }
        return dataset
      },
      version() {
        if (!this.prodBaseApp || !this.prodBaseApp.version) return 'inconnue'
        else if (this.prodBaseApp.version === 'master' || this.prodBaseApp.version === 'latest') return 'de test'
        else return this.prodBaseApp.version
      },
      upgradeAvailable() {
        return this.availableVersions && this.availableVersions.length && this.availableVersions[0].version !== this.prodBaseApp.version && this.availableVersions[0]
      },
    },
    mounted() {
      this.$store.dispatch('fetchTopics', this.application.owner)
    },
    methods: {
      ...mapActions('application', ['patch']),
    },
  }
</script>

<style lang="css">
</style>
