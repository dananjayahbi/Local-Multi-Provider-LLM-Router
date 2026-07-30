import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Router — Local Multi-Provider Gateway",
  description: "Self-hosted local LLM API gateway with intelligent failover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background antialiased">
        {children}
      </body>
    </html>
  );
}
