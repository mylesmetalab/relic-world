import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'uk.co.mylespalmer.relicworld',
  appName: 'Relic World',
  webDir: 'dist',
  // Matches the PWA manifest's theme_color/background_color (public/manifest.webmanifest)
  // so the WKWebView doesn't flash white before the canvas paints.
  backgroundColor: '#0a0a12',
};

export default config;
