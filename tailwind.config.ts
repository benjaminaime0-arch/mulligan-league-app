import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#003800",
        // `cream` is the CTA text + light surface color. Flipped to
        // pure white so on-primary CTA labels read as crisp white,
        // matching the rebrand spec (green button, white text).
        cream: "#FFFFFF",
        // Page-level background. Same green as the primary CTA so the
        // app's surfaces and accents share a single brand green; the
        // logo lockup was darker but reads as the same family in
        // context. Used on every <main> container.
        forest: "#003800",
      },
    },
  },
  plugins: [],
}
export default config
