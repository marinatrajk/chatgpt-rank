import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEO Tool",
  description: "See which products ChatGPT, Claude and Gemini recommend.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
