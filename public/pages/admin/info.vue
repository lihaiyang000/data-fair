<template lang="html">
  <v-container
    v-if="info && status"
    fluid
  >
    <h2 class="title">
      Informations du service
    </h2>
    <p>Version : {{ info.version }}</p>
    <v-expansion-panels>
      <v-expansion-panel
        expand
        focusable
      >
        <v-expansion-panel-header>Statut : {{ status.status }}</v-expansion-panel-header>
        <v-expansion-panel-content>
          <pre v-if="status">{{ JSON.stringify(status, null, 2) }}</pre>
        </v-expansion-panel-content>
      </v-expansion-panel>
      <v-expansion-panel>
        <v-expansion-panel-header>Configuration</v-expansion-panel-header>
        <v-expansion-panel-content>
          <pre v-if="status">{{ JSON.stringify(info.config, null, 2) }}</pre>
        </v-expansion-panel-content>
      </v-expansion-panel>
    </v-expansion-panels>
  </v-container>
</template>

<script>
  export default {
    data() {
      return { info: null, status: null }
    },
    async mounted() {
      this.info = await this.$axios.$get('api/v1/admin/info')
      this.status = await this.$axios.$get('api/v1/status')
    },
  }
</script>

<style lang="css">
</style>
