import Vue from 'vue'
import colors from 'vuetify/es5/util/colors'

import {
  Vuetify,
  VApp,
  VAlert,
  VBtn,
  VBtnToggle,
  VDataTable,
  VGrid,
  VToolbar,
  VCard,
  VSelect,
  VSubheader,
  VAutocomplete,
  VForm,
  VDialog,
  VList,
  VIcon,
  VInput,
  VImg,
  VMenu,
  VTabs,
  VFooter,
  VCheckbox,
  VSwitch,
  VTextarea,
  VTextField,
  VPagination,
  VChip,
  VProgressLinear,
  VProgressCircular,
  VBottomSheet,
  VRadioGroup,
  VStepper,
  VDivider,
  VSnackbar,
  VNavigationDrawer,
  VJumbotron,
  VResponsive,
  VDatePicker,
  VTooltip
} from 'vuetify'
require('vuetify/src/stylus/app.styl')

Vue.use(Vuetify, {
  components: {
    VApp,
    VAlert,
    VBtn,
    VBtnToggle,
    VDataTable,
    VGrid,
    VToolbar,
    VCard,
    VSelect,
    VSubheader,
    VAutocomplete,
    VForm,
    VDialog,
    VList,
    VIcon,
    VInput,
    VImg,
    VMenu,
    VTabs,
    VFooter,
    VCheckbox,
    VSwitch,
    VTextarea,
    VTextField,
    VPagination,
    VChip,
    VProgressLinear,
    VProgressCircular,
    VBottomSheet,
    VRadioGroup,
    VStepper,
    VDivider,
    VSnackbar,
    VNavigationDrawer,
    VJumbotron,
    VResponsive,
    VDatePicker,
    VTooltip
  },
  theme: {
    primary: colors.blue.darken1,
    accent: colors.orange.base
  }
})
