<template>
  <v-card
    height="100%"
    :to="`/remote-service/${remoteService.id}`"
    outlined
    :elevation="hover ? 2 : 0"
    @mouseenter="hover = true"
    @mouseleave="hover = false"
  >
    <v-card-title>
      {{ remoteService.title || remoteService.id }}
    </v-card-title>
    <v-card-text
      style="min-height:60px"
      v-html="marked($options.filters.truncate(remoteService.description || '', 200))"
    />
  </v-card>
</template>

<script>
  const marked = require('marked')

  export default {
    props: ['remoteService'],
    data: () => ({
      marked,
      hover: false,
    }),
  }
</script>

<style lang="css" scoped>
</style>
