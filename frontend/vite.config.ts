/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// La CSP di CloudFront (script-src 'self'; style-src 'self') vieta script/stile inline e URI data:.
// - sourcemap false: nessun .map pubblicato (non serve in produzione e non espone il sorgente);
// - assetsInlineLimit 0: Vite non trasforma mai un asset in data: URI (vietato da img-src/font-src);
// - cssCodeSplit false: un solo file CSS in <link>, niente <style> iniettati a runtime;
// - modulePreload.polyfill false: il polyfill di Vite non e' necessario sui browser moderni.
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
