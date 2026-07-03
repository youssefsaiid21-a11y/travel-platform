import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Orbi - AI Flight Search",
    short_name: "Orbi",
    description: "Search real flights with plain English. Powered by AI.",
    start_url: "/",
    display: "standalone",
    background_color: "#e0f2fe",
    theme_color: "#0284c7",
    icons: [
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
