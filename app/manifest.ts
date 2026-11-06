import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "משמר",
    short_name: "משמר",
    description: "ניהול קריאות ביטחון וסיורים",
    start_url: "/patrol",
    display: "standalone",
    background_color: "#07111a",
    theme_color: "#07111a",
    lang: "he",
    dir: "rtl",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
