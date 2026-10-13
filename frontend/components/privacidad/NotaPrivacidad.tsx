"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pie de una vista con datos de personas (dossier, señal, contrato): qué se tapa y dónde se pide una
 * corrección (Ley 29733, app/(dashboard)/privacidad). Una línea, en la tinta de las notas al pie: no
 * es una advertencia, es cómo se lee lo tapado. El enlace lleva la página para que la persona no
 * tenga que copiarla (ruta relativa: igual en el servidor y en el navegador).
 */
export function NotaPrivacidad({ className }: { className?: string }) {
  const ruta = usePathname() || "/";
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-snug text-mute", className)}>
      <ShieldCheck size={13} className="shrink-0" aria-hidden />
      <span>Datos personales protegidos (Ley 29733): sin DNI y con un apellido tapado. El dato completo está en la fuente oficial.</span>
      <Link
        href={`/privacidad?enlace=${encodeURIComponent(ruta)}#pedido`}
        className="font-medium text-inkSoft underline decoration-line underline-offset-2 transition-colors duration-rapido hover:text-ink hover:decoration-granate"
      >
        ¿Apareces aquí? Pide una corrección
      </Link>
    </p>
  );
}
