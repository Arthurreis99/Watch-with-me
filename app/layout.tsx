import type { Metadata } from "next";
import "./globals.css";

const pagesBasePath = process.env.GITHUB_PAGES === "true" ? "/Watch-with-me" : "";

export const metadata: Metadata = {
  title: "Watch With Me",
  description: "Crie uma sala e assista a vídeos do YouTube em sincronia.",
  manifest: `${pagesBasePath}/manifest.webmanifest`,
  applicationName: "Watch With Me",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Watch With Me",
  },
  icons: {
    icon: `${pagesBasePath}/favicon.svg`,
    shortcut: `${pagesBasePath}/favicon.svg`,
    apple: `${pagesBasePath}/icon-192.png`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
