<template>
  <v-navigation-drawer
    v-model="navContext.drawer"
    class="navigation-left"
    dark
    app
  >
    <v-list class="pa-0">
      <v-list-item
        :href="env.brand.url"
        :to="env.brand.url ? null: '/'"
        :nuxt="true"
      >
        <v-list-item-avatar style="height: 45px;border-radius: 0;">
          <div class="main-logo">
            <img v-if="env.brand.logo" :src="env.brand.logo">
            <img v-else src="~/assets/logo.svg">
          </div>
        </v-list-item-avatar>
        <v-list-item-title><h1>{{ env.brand.title || 'DataFair' }}</h1></v-list-item-title>
      </v-list-item>
      <v-divider />
    </v-list>
    <v-list
      v-if="user && user.adminMode"
      class="py-0"
      color="admin"
      style="background-image: none;"
    >
      <v-list-item tile color="admin">
        <v-list-item-title>Administration</v-list-item-title>
      </v-list-item>
      <v-list-item
        :nuxt="true"
        :to="`/remote-services`"
        :class="routePrefix === 'remote-service' ? 'v-list-item--active' : ''"
      >
        <v-list-item-action><v-icon>mdi-cloud</v-icon></v-list-item-action>
        <v-list-item-title>Services</v-list-item-title>
      </v-list-item>

      <v-list-item :nuxt="true" :to="`/admin/info`">
        <v-list-item-action><v-icon>mdi-information</v-icon></v-list-item-action>
        <v-list-item-title>Informations du service</v-list-item-title>
      </v-list-item>

      <v-list-item :nuxt="true" :to="`/admin/owners`">
        <v-list-item-action><v-icon>mdi-briefcase</v-icon></v-list-item-action>
        <v-list-item-title>Propriétaires</v-list-item-title>
      </v-list-item>

      <v-list-item :nuxt="true" :to="`/admin/errors`">
        <v-list-item-action><v-icon>mdi-alert</v-icon></v-list-item-action>
        <v-list-item-title>Erreurs</v-list-item-title>
      </v-list-item>

      <v-list-item :nuxt="true" :to="`/admin/base-apps`">
        <v-list-item-action><v-icon>mdi-apps</v-icon></v-list-item-action>
        <v-list-item-title>Applications</v-list-item-title>
      </v-list-item>

      <v-list-item :nuxt="true" :href="env.directoryUrl + '/admin/users'">
        <v-list-item-action><v-icon>mdi-account-supervisor</v-icon></v-list-item-action>
        <v-list-item-title>Gestion des comptes</v-list-item-title>
      </v-list-item>

      <template v-if="env.extraAdminNavigationItems">
        <v-list-item
          v-for="extra in env.extraAdminNavigationItems"
          :key="extra.id"
          :nuxt="!!extra.iframe"
          :to="extra.iframe && `/admin-extra/${extra.id}`"
          :href="extra.href"
        >
          <v-list-item-action><v-icon>{{ extra.icon }}</v-icon></v-list-item-action>
          <v-list-item-title>{{ extra.title }}</v-list-item-title>
        </v-list-item>
      </template>
      <v-divider />
    </v-list>

    <v-list nav>
      <template v-if="!missingSubscription">
        <v-list-item
          :nuxt="true"
          :to="`/datasets`"
          :class="routePrefix === 'dataset' ? 'v-list-item--active' : ''"
        >
          <v-list-item-action><v-icon>mdi-database</v-icon></v-list-item-action>
          <v-list-item-title>Jeux de données</v-list-item-title>
        </v-list-item>

        <v-list-item
          :nuxt="true"
          :to="`/applications`"
          :class="routePrefix === 'application' ? 'v-list-item--active' : ''"
        >
          <v-list-item-action><v-icon>mdi-image-multiple</v-icon></v-list-item-action>
          <v-list-item-title>Visualisations</v-list-item-title>
        </v-list-item>

        <v-divider class="pb-2" />

        <v-list-item
          v-if="activeAccount && activeAccount.type === 'organization' && user.organization.role === 'admin'"
          :nuxt="true"
          dense
          :to="`/organization`"
        >
          <v-list-item-action><v-icon>mdi-account-multiple</v-icon></v-list-item-action>
          <v-list-item-content>
            <v-list-item-title>Gestion de l'organisation</v-list-item-title>
            <v-list-item-subtitle>{{ activeAccount.name }}</v-list-item-subtitle>
          </v-list-item-content>
        </v-list-item>

        <v-list-item
          v-if="canAdmin"
          :nuxt="true"
          dense
          to="/settings"
        >
          <v-list-item-action><v-icon>mdi-cog</v-icon></v-list-item-action>
          <v-list-item-content>
            <v-list-item-title>Paramètres</v-list-item-title>
            <v-list-item-subtitle>licences, thématiques ...</v-list-item-subtitle>
          </v-list-item-content>
        </v-list-item>

        <v-list-item
          v-if="canContrib"
          :nuxt="true"
          dense
          :to="`/catalogs`"
          :class="routePrefix === 'catalog' ? 'v-list-item--active' : ''"
        >
          <v-list-item-action><v-icon>mdi-transit-connection</v-icon></v-list-item-action>
          <v-list-item-content>
            <v-list-item-title>Connecteurs</v-list-item-title>
            <v-list-item-subtitle>data.gouv.fr ...</v-list-item-subtitle>
          </v-list-item-content>
        </v-list-item>

        <template v-if="env.extraNavigationItems && user">
          <v-list-item
            v-for="extra in env.extraNavigationItems.filter(extra => !extra.can || (extra.can === 'contrib' && canContrib) || (extra.can === 'admin' && canAdmin))"
            :key="extra.id"
            :nuxt="!!extra.iframe"
            :to="extra.iframe && `/extra/${extra.id}`"
            dense
            :href="extra.href"
          >
            <v-list-item-action><v-icon>{{ extra.icon }}</v-icon></v-list-item-action>
            <v-list-item-content>
              <v-list-item-title>{{ extra.title }}</v-list-item-title>
              <v-list-item-subtitle v-if="extra.subtitle">
                {{ extra.subtitle }}
              </v-list-item-subtitle>
            </v-list-item-content>
          </v-list-item>
        </template>
      </template>
    </v-list>

    <v-footer absolute color="transparent">
      <v-spacer />
      <span class="caption">Maintenu par&nbsp;<a href="https://koumoul.com" style="color: white;">Koumoul</a></span>
    </v-footer>
  </v-navigation-drawer>
</template>

<script>
  import { mapState, mapGetters } from 'vuex'
  export default {
    props: ['navContext'],
    computed: {
      ...mapState(['env']),
      ...mapState('session', ['user']),
      ...mapGetters(['canAdmin', 'canContrib', 'missingSubscription']),
      ...mapGetters('session', ['activeAccount']),
      routePrefix() {
        return this.$route && this.$route.name && this.$route.name.split('-')[0]
      },
    },
  }
</script>

<style lang="css" scoped>
.main-logo img {
  width: 40px;
  height: auto;
}
</style>
