import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Nobel TRIAL is the Mulligan brand font (loaded via next/font/local
        // in src/app/layout.tsx, exposed as the --font-nobel CSS variable).
        // Making it the default `font-sans` means anything that doesn't opt
        // out of Tailwind's sans stack picks up the brand typography.
        sans: ["var(--font-nobel)", "system-ui", "sans-serif"],
        nobel: ["var(--font-nobel)", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        // -50 in design-tool tracking units = -0.05em. Adding a Tailwind
        // alias so `tracking-brand` lines up with the body default set in
        // globals.css, and components that override font can re-apply it.
        brand: "-0.05em",
      },
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
