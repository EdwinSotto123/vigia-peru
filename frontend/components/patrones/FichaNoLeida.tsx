import type { ReactNode } from "react";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { EstadoError } from "./Estados";
import { EncabezadoPagina, Pagina } from "./Estructura";
import { Migas, type Miga } from "./Migas";

/**
 * Una ficha que no se pudo leer (el servidor no respondió, o el código no existe): su ruta, su título y el error con
 * «Reintentar». Nunca datos de relleno en su lugar. Era una copia por ficha (7), unas con «Volver» y otras con Migas.
 */
export function FichaNoLeida({
  migas,
  titulo,
  error,
  reintentar,
  children,
}: {
  migas: Miga[];
  titulo: ReactNode;
  /** El título del error: «No pudimos leer la ficha de esta entidad». */
  error: string;
  /** Adónde lleva el botón; `texto` cambia «Reintentar» (p. ej. «Buscarla en Empresas»). */
  reintentar: { href: string; texto?: string };
  /** Por qué pudo pasar, si no es sólo que el servidor no respondió. */
  children?: ReactNode;
}) {
  return (
    <Pagina>
      <Migas items={migas} />
      <EncabezadoPagina titulo={titulo} />
      <EstadoError titulo={error} accion={<EnlaceAccion href={reintentar.href}>{reintentar.texto ?? "Reintentar"}</EnlaceAccion>}>
        {children ?? "El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento."}
      </EstadoError>
    </Pagina>
  );
}
