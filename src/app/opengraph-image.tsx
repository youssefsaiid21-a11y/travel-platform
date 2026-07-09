import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// A real og:image is table stakes for a good link preview on X/Twitter,
// Slack, iMessage, Product Hunt, etc. - this generates one at build time
// so channels sharing a link get a proper card instead of a blank/generic one.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0284c7 0%, #06b6d4 100%)",
        }}
      >
        <div
          style={{
            fontSize: 96,
            fontWeight: 700,
            color: "white",
            display: "flex",
          }}
        >
          Orbi
        </div>
        <div
          style={{
            fontSize: 36,
            color: "rgba(255,255,255,0.9)",
            marginTop: 16,
            display: "flex",
          }}
        >
          Search real flights with plain English
        </div>
      </div>
    ),
    { ...size }
  );
}
