import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Dev server: serve the game at /play, the same clean URL Vercel gives it. */
const cleanPlayUrl: Plugin = {
  name: 'clean-play-url',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/play' || req.url?.startsWith('/play?')) req.url = req.url.replace('/play', '/play.html');
      next();
    });
  },
};

// Two pages: the physics revision page is the home page (index.html), the badminton game is play.html (/play).
// Each gets its own bundle, so the physics page never loads the game.
export default defineConfig({
  plugins: [cleanPlayUrl],
  build: {
    rollupOptions: {
      input: {
        physics: resolve(__dirname, 'index.html'),
        game: resolve(__dirname, 'play.html'),
      },
    },
  },
});
