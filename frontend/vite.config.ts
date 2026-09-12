import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Honour PORT when the environment assigns one; otherwise use Vite's default.
  server: { port: Number(process.env.PORT) || 5173 },
})
