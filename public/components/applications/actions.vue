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
          :disabled="!can('readConfig')"
          :href="applicationLink"
          target="_blank"
        >
          <v-list-item-avatar>
            <v-icon color="primary">
              mdi-exit-to-app
            </v-icon>
          </v-list-item-avatar>
          <v-list-item-title>Ouvrir en pleine page</v-list-item-title>
        </v-list-item>

        <v-list-item
          v-if="can('writeConfig')"
          @click="showIntegrationDialog = true"
        >
          <v-list-item-avatar>
            <v-icon color="primary">
              mdi-code-tags
            </v-icon>
          </v-list-item-avatar>
          <v-list-item-title>Intégrer dans un site</v-list-item-title>
        </v-list-item>

        <v-list-item
          v-if="can('writeConfig')"
          @click="showCaptureDialog = true"
        >
          <v-list-item-avatar>
            <v-icon color="primary">
              mdi-camera
            </v-icon>
          </v-list-item-avatar>
          <v-list-item-title>Effectuer une capture</v-list-item-title>
        </v-list-item>

        <v-list-item
          v-if="can('delete')"
          @click="showDeleteDialog = true"
        >
          <v-list-item-avatar>
            <v-icon color="warning">
              mdi-delete
            </v-icon>
          </v-list-item-avatar>
          <v-list-item-title>Supprimer</v-list-item-title>
        </v-list-item>

        <v-list-item
          v-if="can('delete')"
          @click="showOwnerDialog = true"
        >
          <v-list-item-avatar>
            <v-icon color="warning">
              mdi-account
            </v-icon>
          </v-list-item-avatar>
          <v-list-item-title>Changer de propriétaire</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
    <v-dialog v-model="showIntegrationDialog">
      <v-card outlined>
        <v-toolbar
          dense
          flat
        >
          <v-toolbar-title>Intégrer dans un site</v-toolbar-title>
          <v-spacer />
          <v-btn
            icon
            @click.native="showIntegrationDialog = false"
          >
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-toolbar>
        <v-card-text v-if="showIntegrationDialog">
          Pour intégrer cette application dans un site vous pouvez copier le code suivant ou un code similaire dans le contenu HTML de votre site.
          <br>
          <pre>
  &lt;iframe src="{{ applicationLink }}?embed=true" width="100%" height="500px" style="background-color: transparent; border: none;"/&gt;
            </pre>
          <br>
          Résultat:
          <iframe
            :src="applicationLink + '?embed=true'"
            width="100%"
            height="500px"
            style="background-color: transparent; border: none;"
          />
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="showCaptureDialog"
      max-width="500"
    >
      <v-card outlined>
        <v-toolbar
          dense
          flat
        >
          <v-toolbar-title>Effectuer une capture</v-toolbar-title>
          <v-spacer />
          <v-btn
            icon
            @click.native="showCaptureDialog = false"
          >
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-toolbar>
        <v-card-text v-if="showCaptureDialog" class="pb-0 pt-2">
          <p>Une image statique au format PNG va être créée à partir de cette visualisation.</p>
          <v-text-field
            v-model="captureWidth"
            label="Largeur"
            type="number"
          />
          <v-text-field
            v-model="captureHeight"
            label="Hauteur"
            type="number"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            color="primary"
            icon
            :href="`${env.captureUrl}/api/v1/screenshot?target=${encodeURIComponent(applicationLink)}&width=${captureWidth}&height=${captureHeight}`"
            download
            title="télécharger la capture"
          >
            <v-icon>mdi-download</v-icon>
          </v-btn>
          <v-spacer />
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="showDeleteDialog"
      max-width="500"
    >
      <v-card outlined>
        <v-card-title primary-title>
          Suppression de la visualisation
        </v-card-title>
        <v-card-text>
          Voulez vous vraiment supprimer la visualisation "{{ application.title }}" ? La suppression est définitive et le paramétrage ne pourra pas être récupéré.
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
      <v-card outlined>
        <v-card-title primary-title>
          Changer le propriétaire de l'application
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
  </div>
</template>

<script>
  import { mapState, mapActions, mapGetters } from 'vuex'
  import OwnerPick from '~/components/owners/pick.vue'

  export default {
    components: { OwnerPick },
    data: () => ({
      showDeleteDialog: false,
      showIntegrationDialog: false,
      showCaptureDialog: false,
      showOwnerDialog: false,
      newOwner: null,
      captureWidth: 800,
      captureHeight: 450,
    }),
    computed: {
      ...mapState(['env']),
      ...mapState('application', ['application', 'api']),
      ...mapGetters('application', ['resourceUrl', 'can', 'applicationLink']),
    },
    methods: {
      ...mapActions('application', ['setId', 'patch', 'remove', 'clear', 'changeOwner', 'subscribe']),
      async confirmRemove() {
        this.showDeleteDialog = false
        await this.remove()
        this.$router.push({ path: '/applications' })
      },
    },
  }
</script>

<style>
</style>
