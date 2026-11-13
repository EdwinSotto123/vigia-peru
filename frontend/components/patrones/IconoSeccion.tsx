"use client";

import { usePathname } from "next/navigation";
import {
  BookOpen, Briefcase, Building2, FileSearch, Flag, Heart, Landmark, LayoutGrid, MapPin, MessageCircleQuestion, MessageSquareWarning, Network, Radio, Scale, Users,
  type LucideIcon,
} from "lucide-react";

/**
 * La placa con el ícono de la sección, junto al título de cada página: el mismo ícono que su entrada del menú, para que
 * una ficha de entidad, una de empresa y una lista de contratos se distingan de un vistazo (antes, todas abrían con un
 * título de texto igual). Sale de la ruta: ninguna página tiene que pasarlo. El orden importa (lo más específico primero).
 */
const POR_RUTA: [RegExp, LucideIcon][] = [
  [/^\/app\/asistente/, MessageCircleQuestion],
  [/^\/app\/(mapa|financiar)|^\/region\//, MapPin],
  [/^\/app\/entidades|^\/entidad\/|^\/app\/comparar/, Building2],
  [/^\/app\/empresas|^\/empresa\//, Briefcase],
  [/^\/app\/personas/, Users],
  [/^\/app\/partidos/, Landmark],
  [/^\/app\/poder/, Network],
  [/^\/app\/contratos/, FileSearch],
  [/^\/app\/(hallazgos|novedades)/, Flag],
  [/^\/app\/denuncias|^\/reporte/, MessageSquareWarning],
  [/^\/app\/(apoyar|aliados|cuanto-cuesta|mi-impacto)/, Heart],
  [/^\/app\/auditoria/, Radio],
  [/^\/glosario|^\/preguntas/, BookOpen],
  [/^\/(metodologia|fuentes|privacidad)|^\/app\/ia/, Scale],
  [/^\/app$/, LayoutGrid],
];

export function IconoSeccion() {
  const ruta = usePathname() ?? "";
  const Icono = POR_RUTA.find(([re]) => re.test(ruta))?.[1];
  if (!Icono) return null;
  return (
    <span className="mt-0.5 hidden h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-paper text-granate sm:grid" aria-hidden>
      <Icono size={19} strokeWidth={1.8} />
    </span>
  );
}
