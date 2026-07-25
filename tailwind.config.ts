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
        // -50 in design-tool tracking units = -0.05em, the tight end of the
        // brand's -0.02..-0.05em range. This is only an opt-in utility; the
        // -0.02em default lives on `body` in globals.css.
        brand: "-0.05em",
      },
      colors: {
        primary: "#003800",
        // Brand system tokens (Mulligan brand kit):
        // Or Mat — accent only, never dominant (≤10% of any surface).
        gold: "#C2A45F",
        // Noir Charbon — body/text color on light surfaces.
        charcoal: "#1A1A1A",
        // Blanc Cassé — light surface color (auth panel background).
        bone: "#F7F4EC",
        // Hover darken for primary CTAs (brand kit --green-deep).
        "primary-deep": "#002B00",
        // Body copy on green surfaces — the brand kit's muted sage, used
        // instead of a white opacity so text on #003800 stays warm.
        sage: "#BFCDB8",
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
