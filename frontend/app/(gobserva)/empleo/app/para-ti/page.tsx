import { redirect } from "next/navigation";
import { RUTA_PARA_TI } from "@/lib/empleo";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

/**
 * «Para ti» dejó de ser una página aparte (2026-11-08): es el filtro «Para ti» de la lista de plazas. Los enlaces de
 * antes (correos, avisos, marcadores) llevan ahí.
 */
export default function Page() {
  redirect(rutaEn(baseProducto("empleo"), RUTA_PARA_TI));
}
