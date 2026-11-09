import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "chatgpt-rank",
  description: "See whether ChatGPT recommends your brand, query by query.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
