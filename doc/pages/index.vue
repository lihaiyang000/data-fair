<template>
  <div>
    <v-img
      src="./images/ThemePark.svg"
      height="500px"
    >
      <v-container class="fill-height">
        <v-row align="center">
          <v-col class="text-center">
            <h3 class="display-4">
              {{ $t("common.title") }}
            </h3>
            <span class="headline">{{ $t("common.description") }}</span>
            <v-divider class="my-3" />
            <v-btn
              large
              href="https://github.com/koumoul-dev/data-fair"
            >
              <img src="../static/images/GitHub-Mark-32px.png">&nbsp;Github
            </v-btn>
          </v-col>
        </v-row>
      </v-container>
    </v-img>
    <v-container class="justify">
      <v-col
        md="10"
        offset-md="1"
      >
        <blockquote
          class="blockquote display-1"
          style="text-align: center"
        >
          {{ $t("pages.root.description") }}
        </blockquote>
      </v-col>
      <v-row>
        <v-col
          v-for="(feature, $index) in features"
          :key="$index"
          md="4"
          class="pa-5"
        >
          <v-card height="100%">
            <v-card-title
              primary-title
              style="height:15%"
            >
              <h3
                class="title"
                style="text-align: center"
              >
                {{ $t(`pages.user-guide.${feature.id}.title`) }}
              </h3>
            </v-card-title>
            <v-img
              :src="feature.img"
              height="160px"
            />
            <v-card-text style="height:45%;min-height:80px">
              {{ $t(`pages.user-guide.${feature.id}.description`) }}
            </v-card-text>

            <v-card-actions style="height:10%">
              <v-spacer />
              <v-btn
                :to="localePath({name: 'user-guide-id', params: {id: feature.id}})"
                color="primary"
              >
                {{ $t("common.seemore") }}
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </div>
</template>

<script>
  export default {
    data: () => ({
      features: [{
        img: './images/file.png',
        id: 'dataset',
      }, {
        img: './images/smartphone.png',
        id: 'application',
      }, {
        img: './images/robot.png',
        id: 'service',
      }],
    }),
  }
</script>

<style>

.jumbotron__image {
  width: 100%
}
</style>
