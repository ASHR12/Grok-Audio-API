import type { Metadata } from "next";
import "./globals.css";

const FAVICON_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23c9f26c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z'/%3E%3Cpath d='M19 10v2a7 7 0 0 1-14 0v-2'/%3E%3Cline x1='12' y1='19' x2='12' y2='23'/%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: "Grok Voice Studio — Realtime STT & TTS",
  description:
    "A production-grade open-source playground for Grok's realtime Speech-to-Text and Text-to-Speech WebSocket APIs.",
  icons: {
    icon: [{ url: FAVICON_SVG, type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen relative">
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
