import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'public',
  
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks: {
          'three': ['three'],
          'three-examples': [
            'three/examples/jsm/controls/OrbitControls',
            'three/examples/jsm/exporters/STLExporter',
            'three/examples/jsm/exporters/OBJExporter',
            'three/examples/jsm/utils/BufferGeometryUtils.js'
          ],
          'ui': ['dat.gui']
        }
      }
    },
    chunkSizeWarningLimit: 1000,
  },
  
  server: {
    port: 3000,
    open: true,
    cors: true,
  },
  
  preview: {
    port: 4173,
    open: true,
  },
  
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/controls/OrbitControls',
      'three/examples/jsm/exporters/STLExporter',
      'three/examples/jsm/exporters/OBJExporter',
      'three/examples/jsm/utils/BufferGeometryUtils.js',
      'dat.gui'
    ],
  },
  
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@types': resolve(__dirname, './src/types'),
      '@utils': resolve(__dirname, './src/utils'),
      '@loft-editor': resolve(__dirname, './src/loft-editor'),
    },
  },
});



