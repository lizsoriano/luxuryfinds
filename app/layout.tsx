  import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { CartProvider } from "../lib/cart/CartContext";
import { FavoritesProvider } from "../lib/favorites/FavoritesContext";
import { readSiteContent } from "../lib/supabase/site-content";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export async function generateMetadata(): Promise<Metadata> {
  const content = await readSiteContent();
  const incomingHeaders = await headers();
  const host = incomingHeaders.get("x-forwarded-host") ?? incomingHeaders.get("host") ?? "luxuryfinds.mx";
  const protocol = incomingHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title: { default: "Luxury Finds", template: "%s | Luxury Finds" },
    description: content.seoDescription,
    metadataBase: new URL(content.canonicalOrigin),
    icons: { icon: "/favicon.png", shortcut: "/favicon.png", apple: "/favicon.png" },
    openGraph: { title: content.seoTitle, description: content.seoDescription, images: [{ url: `${origin}/og-logo.png`, width: 1200, height: 630, alt: "Logo de Luxury Finds" }] },
    twitter: { card: "summary_large_image", title: content.seoTitle, description: content.seoDescription, images: [{ url: `${origin}/og-logo.png`, width: 1200, height: 630, alt: "Logo de Luxury Finds" }] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        {/* Stable fallback for tabs whose generated CSS URL belongs to an older deployment. */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/styles/luxury-finds.css" />
      </head>
      <body className={`${inter.className} ${inter.variable} antialiased`}>
        <CartProvider>
          <FavoritesProvider>{children}</FavoritesProvider>
        </CartProvider>
      </body>
    </html>
  );
}
