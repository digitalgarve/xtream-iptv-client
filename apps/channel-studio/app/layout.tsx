import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Channel Studio – Deine Sender sortieren",
  description: "Senderlisten vorübergehend bearbeiten und zurück auf den TV übertragen.",
  referrer: "no-referrer",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="antialiased">{children}</body>
    </html>
  );
}
