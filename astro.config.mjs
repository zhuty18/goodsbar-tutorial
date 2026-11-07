import { defineConfig } from "astro/config"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  // site: 'https://goodsbar.example.com',
  base: "/goodsbar-tutorial/",
  vite: {
    plugins: [tailwindcss()],
  },
})
