<template>
  <v-container class="pa-0" fluid>
    <v-iframe v-if="missingSubscription" :src="env.subscriptionUrl" />
    <v-col
      v-else
      md="6"
      offset-md="3"
    >
      <v-responsive>
        <v-container class="fill-height">
          <v-row align="center">
            <v-col class="text-center">
              <h3 class="display-1 mb-3 mt-5">
                {{ $t('common.title') }}
              </h3>
              <div class="text-h6">
                {{ $t('pages.root.description') }}
              </div>
              <template v-if="initialized && !user">
                <p class="title mt-5">
                  {{ $t('common.authrequired') }}
                </p>
                <v-btn
                  color="primary"
                  @click="login"
                >
                  {{ $t('common.login') }}
                </v-btn>
              </template>
            </v-col>
          </v-row>
        </v-container>
      </v-responsive>
    </v-col>
  </v-container>
</template>

<script>
  import 'iframe-resizer/js/iframeResizer'
  import VIframe from '@koumoul/v-iframe'
  const { mapState, mapActions, mapGetters } = require('vuex')

  export default {
    name: 'Home',
    components: { VIframe },
    data: () => ({
      stats: null,
      headers: [
        { text: '', value: 'name', sortable: false },
        { text: 'Nombre de jeux de données', value: 'datasets', sortable: false },
        { text: 'Espace consommé', value: 'storage', sortable: false },
        { text: 'Espace total disponible', value: 'storageLimit', sortable: false },
        { text: 'Nombre d\'applications', value: 'applications', sortable: false },
      ],
    }),
    computed: {
      ...mapState('session', ['user', 'initialized']),
      ...mapState(['env']),
      ...mapGetters(['missingSubscription']),
      items() {
        if (!this.stats) return []
        const orgasItems = this.user.organizations.map(o => {
          return { name: o.name, ...this.stats.organizations[o.id] }
        })
        return [{ name: 'Espace personnel', ...this.stats.user }].concat(orgasItems)
      },
    },
    watch: {
      user: {
        async handler(user) {
          if (user) this.stats = await this.$axios.$get('api/v1/stats')
        },
        immediate: true,
      },
    },
    methods: {
      ...mapActions('session', ['login']),
    },
  }
</script>
