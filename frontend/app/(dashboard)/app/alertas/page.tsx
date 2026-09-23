import { redirect } from "next/navigation";
import { senalesQueryString, type NivelBandera } from "@/lib/revision";

// Nunca llega a pintarse (redirige), pero una pestaña que se detiene en el redirect no queda sin título.
export const metadata = { title: "Señales" };

/**
 * /app/alertas ya no existe como superficie: es /app/hallazgos.
 *
 * Listaba *contratos* —una tarjeta con sombra por fila, un círculo de score de
 * 48 px y los slugs de las reglas (`unico_postor_alto`) como píldoras— cuando la
 * unidad atómica del producto es la **señal**. Tener las dos superficies dejaba dos
 * puertas al mismo sitio, que es justo lo que este producto ya decidió no hacer
 * (un destino, un botón). Los enlaces existentes (AlertasDeZona, la barra lateral)
 * siguen funcionando: caen aquí y se redirigen.
 *
 * Se traduce lo único del filtro viejo que tiene equivalente honesto:
 *  - `scoreMin` ≥ 70 / ≥ 40 → severidad alta / media. No es el mismo eje (aquel era
 *    el score del contrato, este la severidad de la señal), pero es la intención.
 *  - `region` se descarta a propósito: el campo mezcla departamentos con provincias
 *    y 84 de 94 alertas no tienen coordenadas. Filtrar por él daba una geografía
 *    falsa; se prefiere mandar al índice completo antes que a un subconjunto mentiroso.
 *  - `estado=en_revision` → la vista de revisión humana, que ahora sí tiene datos:
 *    el filtro viejo comparaba contra un literal que no existe en la base
 *    (`en_revision` vs `revision`) y además la consulta excluye ese estado, así que
 *    devolvía cero siempre.
 */
export default function AlertasRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const s = (k: string) => (typeof searchParams?.[k] === "string" ? (searchParams[k] as string) : undefined);
  const scoreMin = Number(s("scoreMin"));
  const severidad: NivelBandera | undefined =
    Number.isFinite(scoreMin) && scoreMin >= 70 ? "alta" : Number.isFinite(scoreMin) && scoreMin >= 40 ? "media" : undefined;

  const qs = senalesQueryString({
    vista: s("estado") === "en_revision" ? "revision" : "publicadas",
    severidad,
  });
  redirect(qs ? `/app/hallazgos?${qs}` : "/app/hallazgos");
}
