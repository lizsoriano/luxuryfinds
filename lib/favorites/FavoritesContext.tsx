"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

type FavoritesContextValue = {
  isFavorited: (identity: string) => boolean;
  /** Toggles a favorite by its slug-or-id identity (see lib/cart/CartContext.tsx for the same convention). Redirects to login when signed out. */
  toggleFavorite: (identity: string) => Promise<void>;
  pending: boolean;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [identities, setIdentities] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/favorites")
      .then((res) => res.json())
      .then((body: { authenticated: boolean; identities?: string[] }) => {
        if (cancelled || !body.identities) return;
        setIdentities(new Set(body.identities));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const isFavorited = useCallback((identity: string) => identities.has(identity), [identities]);

  const toggleFavorite = useCallback(
    async (identity: string) => {
      setPending(true);
      try {
        const res = await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identity }),
        });
        if (res.status === 401) {
          router.push(`/login?next=${encodeURIComponent(pathname || "/")}`);
          return;
        }
        if (!res.ok) return;
        const body: { favorited: boolean } = await res.json();
        setIdentities((current) => {
          const next = new Set(current);
          if (body.favorited) next.add(identity);
          else next.delete(identity);
          return next;
        });
      } finally {
        setPending(false);
      }
    },
    [router, pathname],
  );

  const value = useMemo<FavoritesContextValue>(
    () => ({ isFavorited, toggleFavorite, pending }),
    [isFavorited, toggleFavorite, pending],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (!context) throw new Error("useFavorites debe usarse dentro de un FavoritesProvider.");
  return context;
}
