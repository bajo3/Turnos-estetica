import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT || 5173),
<<<<<<< HEAD
    allowedHosts: ['.up.railway.app']
=======
    allowedHosts: 'all'
>>>>>>> dd010e9 (fix server.js)
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT || 4173),
<<<<<<< HEAD
    strictPort: true,
    allowedHosts: ['.up.railway.app']
=======
    allowedHosts: 'all'
>>>>>>> dd010e9 (fix server.js)
  }
});