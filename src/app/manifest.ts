import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Mulligan",
    short_name: "Mulligan",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#F7F4EC",
    theme_color: "#003800",
    icons: [{ src: "/logo-mark.png", sizes: "512x512", type: "image/png", purpose: "any" }],
  }
}
