import './app.css';
import App from './App.svelte';
import { adoptTokenFromLocation } from './lib/utils/apiToken';

// A link that carries the API token as #token=… hands it over before the
// first request, and leaves the address bar without it.
adoptTokenFromLocation();

const app = new App({
  target: document.getElementById('app')!,
});

export default app;
