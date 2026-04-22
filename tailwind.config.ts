import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#0F3D2E",
        // `cream` is the page background. Stepped from the previous
        // #C6D9B7 (muted sage) to a noticeably lighter tint so the dark
        // primary content pops against more whitespace. Still clearly in
        // the sage/green family — reads as a softer version, not a
        // palette change.
        cream: "#E3EDD6",
      },
    },
  },
  plugins: [],
}
export default config
