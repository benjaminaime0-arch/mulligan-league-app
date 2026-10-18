import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        // Tight display tracking remains opt-in; body text uses natural spacing.
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
