import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import ui from '@nuxt/ui/vue-plugin';
import App from './App.vue';
import BlockApp from './BlockApp.vue';
import './styles.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
});
// `?schema=2` opens the block pieces; the HTML documents stay the default.
const blocks = new URLSearchParams(window.location.search).get('schema') === '2';
createApp(blocks ? BlockApp : App)
  .use(router)
  .use(ui)
  .mount('#app');
