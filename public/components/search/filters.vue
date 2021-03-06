<template lang="html">
  <v-col class="pa-0">
    <v-row>
      <v-col
        cols="12"
        sm="5"
        md="4"
        lg="3"
        class="pb-0"
      >
        <v-text-field
          v-model="filters.q"
          placeholder="Rechercher"
          outlined
          dense
          append-icon="mdi-magnify"
          hide-details
          @keyup.enter.native="writeParams"
          @click:append="writeParams"
        />
      </v-col>
      <v-switch
        v-model="showShared"
        label="inclure ressources partagées"
        @change="writeParams"
      />
    </v-row>
    <v-row class="px-3">
      <template v-for="filter in Object.keys(fullFilterLabels)">
        <v-chip
          v-if="filters[filter]"
          :key="filter"
          close
          small
          color="accent"
          text-color="white"
          @click:close="filters[filter] = null;writeParams(filter)"
        >
          <strong v-if="filter === 'showAll'">Vue administrateur : {{ owners.length ? owners.join(', ') : 'tout voir' }}</strong>
          <strong v-else>{{ fullFilterLabels[filter] }} : {{ filters[filter] }}</strong>
        </v-chip>
      </template>
    </v-row>
  </v-col>
</template>

<script>
  import { mapActions, mapState, mapGetters } from 'vuex'

  export default {
    props: ['filters', 'filterLabels', 'facets', 'type', 'hideOwners'],
    data: () => ({
      owners: [],
      showShared: null,
    }),
    computed: {
      ...mapState('session', ['user']),
      ...mapGetters('session', ['activeAccount']),
      fullFilterLabels() {
        return {
          ...this.filterLabels,
          showAll: 'Tout voir',
        }
      },
      ownerCount() {
        if (!this.facets) return {}
        if (this.hideOwners) return {}
        const others = this.facets.owner.filter(o => (o.value.type === 'user' && (!this.user || o.value.id !== this.user.id)) || (o.value.type === 'organization' && (!this.user || !this.user.organizations || !this.user.organizations.map(o => o.id).includes(o.value.id))))
        const counts = { others: others.map(f => f.count).reduce((total, count) => total + count, 0) }
        if (this.user) {
          const userCount = this.facets.owner.find(o => o.value.type === 'user' && o.value.id === this.user.id)
          if (userCount) Object.assign(counts, { ['user:' + this.user.id]: userCount.count });
          (this.user.organizations || []).forEach(orga => {
            const orgaCount = this.facets.owner.filter(o => o.value.type === 'organization' && o.value.id === orga.id).reduce((acc, val) => acc + val.count, 0)
            if (orgaCount) Object.assign(counts, { ['organization:' + orga.id]: orgaCount })
          })
        }
        return counts
      },
    },
    watch: {
      '$route'() {
        this.readParams()
      },
    },
    created() {
      this.readParams()
    },
    methods: {
      ...mapActions(['searchQuery']),
      readParams() {
        Object.keys(this.fullFilterLabels).forEach(key => {
          this.$set(this.filters, key, this.$route.query[key])
        })
        this.$set(this.filters, 'q', this.$route.query.q)
        this.showShared = this.$route.query.shared === 'true'
        if (this.$route.query.owner) {
          this.owners = this.$route.query.owner.split(',')
          if (this.user) this.$set(this.filters, 'owner', this.$route.query.owner.replace('others', '-user:' + this.user.id + ',' + this.user.organizations.map(o => '-organization:' + o.id).join(',')))
        } else if (this.showShared) {
          this.$set(this.filters, 'owner', null)
        } else {
          this.$set(this.filters, 'owner', `${this.activeAccount.type}:${this.activeAccount.id}`)
        }
        this.$emit('apply')
      },
      writeParams() {
        const query = { ...this.$route.query }
        Object.keys(this.filters).forEach(key => {
          if (![null, undefined, '', true].includes(this.filters[key])) query[key] = '' + this.filters[key]
          else delete query[key]
        })
        query.shared = '' + this.showShared
        if (this.filters.showAll && this.owners.length) query.owner = this.owners.join(',').replace()
        else delete query.owner
        this.$router.push({ query })
        console.log(query)
        this.searchQuery({ type: this.type, query })
      },
    },
  }
</script>

<style lang="css">
</style>
