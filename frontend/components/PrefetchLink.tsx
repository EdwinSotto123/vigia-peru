"use client";

import Link from "next/link";
import { prefetchDossier } from "@/lib/dossier-cache";

/**
 * Link a un dossier que, al hacer hover/focus, prefetchea los datos del análisis
 * (no solo la ruta). Para cuando el usuario hace click, el dossier ya está en
 * cache → navegación instantánea.
 *
 * `ocid` es el codigoconvocatoria/ocid que alimenta /api/agent/history/[id].
 */
export function PrefetchLink({
  href,
  ocid,
  className,
  children,
}: {
  href: string;
  ocid: string;
  className?: string;
  children: React.ReactNode;
}) {
  const warm = () => {
    if (ocid) prefetchDossier(ocid);
  };
  return (
    <Link
      href={href}
      className={className}
      onMouseEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
    >
      {children}
    </Link>
  );
}
