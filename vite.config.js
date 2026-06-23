import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//http://SERVER_IP:SERVER_PORT
export default defineConfig({
  plugins: [react()],

  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5053',
        changeOrigin: true,
  },
},
  },
});
