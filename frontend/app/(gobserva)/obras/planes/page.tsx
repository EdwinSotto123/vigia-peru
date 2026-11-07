import { permanentRedirect } from "next/navigation";
import { urlCanonica } from "@/lib/gobserva";

/**
 * Obras viene incluido en Gobserva Licitaciones (2026-11-07): una sola plataforma para quien le vende al Estado, con un
 * solo plan. Los planes de Obras pasan a los de Licitaciones.
 */
export default function PlanesObras() {
  permanentRedirect(urlCanonica("licitaciones", "/planes"));
}
