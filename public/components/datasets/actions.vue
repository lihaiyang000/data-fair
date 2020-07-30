<template>
  <div class="actions-buttons">
    <v-menu bottom left>
      <template v-slot:activator="{on}">
        <v-btn
          fab
          small
          color="accent"
          v-on="on"
        >
          <v-icon>mdi-dots-vertical</v-icon>
        </v-btn>
      </template>
      <v-list>
        <v-list-item
          v-for="dataFile in (dataFiles || [])"
          :key="dataFile.key"
          :disabled="!can('downloadFullData')"
          :href="dataFile.url"
        >
          <v-list-item-avatar>
            <v-icon color="primary">
              mdi-file-download
            </v-icon>
          </v-list-item-avatar>
          <v-list-item-title>{{ dataFile.title }}</v-list-item-title>
        </v-list-item>
        <v-list-item
          v-if="can('writeData')"
          @click="showUploadDialog = true"
        >
          <v-list-item-avatar>
            <v-icon color="warning">
              mdi-file-upload
            </v-icon>
          </v-list-item-avatar>
          <v-list-item-title>Remplacer</v-list-item-title>
        </v-list-item>
        <v-list-item v-if="can('delete')" @click="showDeleteDialog = true">
          <v-list-item-avatar>
            <v-icon color="warning">
              mdi-delete
            </v-icon>
          </v-list-item-avatar>
          <v-list-item-title>Supprimer</v-list-item-title>
        </v-list-item>
        <v-list-item v-if="can('delete')" @click="showOwnerDialog = true">
          <v-list-item-avatar>
            <v-icon color="warning">
              mdi-account
            </v-icon>
          </v-list-item-avatar>
          <v-list-item-title>Changer de propriétaire</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
    <v-dialog
      v-model="showDeleteDialog"
      max-width="500"
    >
      <v-card>
        <v-card-title primary-title>
          Suppression du jeu de données
        </v-card-title>
        <v-card-text v-if="nbApplications > 0">
          <v-alert
            :value="nbApplications === 1"
            type="error"
            outlined
          >
            Attention ! Ce jeu de données est utilisé par une application. Si vous le supprimez cette application ne sera plus fonctionnelle.
          </v-alert>
          <v-alert
            :value="nbApplications > 1"
            type="error"
            outlined
          >
            Attention ! Ce jeu de données est utilisé par {{ nbApplications }} applications. Si vous le supprimez ces applications ne seront plus fonctionnelles.
          </v-alert>
        </v-card-text>
        <v-card-text>
          Voulez vous vraiment supprimer le jeu de données "{{ dataset.title }}" ? La suppression est définitive et les données ne pourront pas être récupérées.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn text @click="showDeleteDialog = false">
            Non
          </v-btn>
          <v-btn
            color="warning"
            @click="confirmRemove"
          >
            Oui
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="showOwnerDialog"
      max-width="900"
    >
      <v-card>
        <v-card-title primary-title>
          Changer le propriétaire du jeu de données
        </v-card-title>
        <v-card-text>
          <owner-pick v-model="newOwner" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn text @click="showOwnerDialog = false">
            Annuler
          </v-btn>
          <v-btn
            :disabled="!newOwner"
            color="warning"
            @click="changeOwner(newOwner); showOwnerDialog = false;"
          >
            Confirmer
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="showUploadDialog"
      max-width="500"
    >
      <v-card>
        <v-card-title primary-title>
          Remplacement des données
        </v-card-title>
        <v-card-text v-if="nbApplications > 0">
          <v-alert
            :value="nbApplications === 1"
            type="error"
            outlined
          >
            Attention ! Ce jeu de données est utilisé par une application. Si vous modifiez sa structure l'application peut ne plus fonctionner.
          </v-alert>
          <v-alert
            :value="nbApplications > 1"
            type="error"
            outlined
          >
            Attention ! Ce jeu de données est utilisé par {{ nbApplications }} applications. Si vous modifiez sa structure ces applications peuvent ne plus fonctionner.
          </v-alert>
        </v-card-text>
        <v-card-text>
          <input
            type="file"
            @change="onFileUpload"
          >
          <v-progress-linear
            v-if="uploading"
            v-model="uploadProgress"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn text @click="showUploadDialog = false">
            Annuler
          </v-btn>
          <v-btn
            :disabled="!file || uploading"
            color="warning"
            @click="confirmUpload"
          >
            Charger
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
  import { mapState, mapGetters, mapActions } from 'vuex'
  import OwnerPick from '~/components/owners/pick.vue'
  import eventBus from '~/event-bus'

  export default {
    components: { OwnerPick },
    data: () => ({
      showDeleteDialog: false,
      showUploadDialog: false,
      showOwnerDialog: false,
      file: null,
      uploading: false,
      uploadProgress: 0,
      newOwner: null,
    }),
    computed: {
      ...mapState('dataset', ['dataset', 'nbApplications', 'dataFiles']),
      ...mapGetters('dataset', ['can']),
      downloadLink() {
        return this.dataset ? this.resourceUrl + '/raw' : null
      },
      downloadFullLink() {
        return this.dataset ? this.resourceUrl + '/full' : null
      },
    },
    methods: {
      ...mapActions('dataset', ['remove', 'changeOwner']),
      async confirmRemove() {
        this.showDeleteDialog = false
        await this.remove()
        this.$router.push({ path: '/datasets' })
      },
      onFileUpload(e) {
        this.file = e.target.files[0]
      },
      async confirmUpload() {
        const options = {
          onUploadProgress: (e) => {
            if (e.lengthComputable) {
              this.uploadProgress = (e.loaded / e.total) * 100
            }
          },
        }
        const formData = new FormData()
        formData.append('file', this.file)

        this.uploading = true
        try {
          await this.$axios.$put('api/v1/datasets/' + this.dataset.id, formData, options)
          this.showUploadDialog = false
        } catch (error) {
          const status = error.response && error.response.status
          if (status === 413) {
            eventBus.$emit('notification', { type: 'error', msg: 'Le fichier est trop volumineux pour être importé' })
          } else if (status === 429) {
            eventBus.$emit('notification', { type: 'error', msg: 'Le propriétaire sélectionné n\'a pas assez d\'espace disponible pour ce fichier' })
          } else {
            eventBus.$emit('notification', { error, msg: 'Erreur pendant l\'import du fichier:' })
          }
        }
        this.uploading = false
      },
    },
  }
</script>

<style lang="css" scoped>
</style>