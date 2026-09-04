import { createApp } from 'vue'
import type {} from 'antd-vue-volar'
// @ts-ignore
import App from './App.vue'
import 'ant-design-vue/es/message/style'
import 'ant-design-vue/es/notification/style'
import 'ant-design-vue/es/modal/style'
import './index.scss'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { i18n } from './i18n'
import VueDiff from 'vue-diff'
import { listenForHostHide } from './util/pauseOnHostHide'

import 'vue-diff/dist/index.css';

// Before mount, and outside the Vue tree on purpose: this listens for the host
// page hiding the gallery (a Gradio tab switch, which no event inside this
// document can see) and for the browser tab going away. Neither depends on any
// component being alive.
listenForHostHide()

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
createApp(App)
  .use(pinia)
  .use(i18n)
  .use(VueDiff, {
    componentName: 'VueDiff',
  })
  .mount('#zanllp_dev_gradio_fe')

