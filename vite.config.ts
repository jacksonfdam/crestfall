import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // Perf budget: whole payload under 8 MB; warn well before that.
    chunkSizeWarningLimit: 1500,
  },
  worker: { format: 'es' },
});
