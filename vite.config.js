import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'FinSight — Personal Finance',
        short_name: 'FinSight',
        description: 'A private, offline-first personal finance tracker for Indian households.',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/finsight-insight-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/finsight-insight-maskable-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Bump cacheId to invalidate the old precache so installed PWAs pick up the
        // new icon/manifest instead of serving the cached old one (registerType is
        // 'autoUpdate'). Increment this string on future cache-busting changes.
        cacheId: 'finsight-v2',
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html'
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src')
    }
  },
  server: {
    port: 5173,
    host: true
  }
});
