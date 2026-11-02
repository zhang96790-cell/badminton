import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Two pages: the badminton game (index.html) and the physics revision page (physics.html).
// Each gets its own bundle, so the physics page never loads the game.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        physics: resolve(__dirname, 'physics.html'),
      },
    },
  },
});
