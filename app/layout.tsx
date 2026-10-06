  import type { Metadata } from "next";
import { Inter } from "next/font/google";
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
  const origin = content.canonicalOrigin.replace(/\/$/, "");
  return {
    title: { default: "Luxury Finds", template: "%s | Luxury Finds" },
    description: content.seoDescription,
    metadataBase: new URL(content.canonicalOrigin),
    icons: { icon: "/favicon.png", shortcut: "/favicon.png", apple: "/favicon.png" },
    openGraph: { type: "website", siteName: "Luxury Finds", url: origin, title: content.seoTitle, description: content.seoDescription, images: [{ url: `${origin}/og-banner.jpg`, width: 1920, height: 900, alt: "Banner de Rare Beauty en Luxury Finds", type: "image/jpeg" }] },
    twitter: { card: "summary_large_image", title: content.seoTitle, description: content.seoDescription, images: [{ url: `${origin}/og-banner.jpg`, width: 1920, height: 900, alt: "Banner de Rare Beauty en Luxury Finds", type: "image/jpeg" }] },
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
