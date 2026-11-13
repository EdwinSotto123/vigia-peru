import type { Metadata } from "next";
import { HeartHandshake } from "lucide-react";
import { canonica, NO_INDEXAR } from "@/lib/seo";
import { Ayuda, EncabezadoPagina, Migas, Pagina } from "@/components/patrones";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { SeccionAportar } from "@/components/apoyo/SeccionAportar";
import { SeccionAliados } from "@/components/apoyo/SeccionAliados";
import { SeccionAportes } from "@/components/apoyo/SeccionAportes";
import { SeccionCostos } from "@/components/apoyo/SeccionCostos";
import { ETIQUETA_APOYO, HREF_APOYO, VISTAS_APOYO, VistasApoyo, type VistaApoyo } from "@/components/sitio/VistasSeccion";
import { uno } from "@/lib/utils";

type Params = Record<string, string | string[] | undefined>;

const seccionDe = (sp?: Params): VistaApoyo => {
  const pedida = uno(sp?.seccion);
  return VISTAS_APOYO.find((v) => v === pedida) ?? "aportar";
};

/** Cada pestaña con su título y su descripción; la de los aportes (nombres de quienes aportan), sin indexar. */
export function generateMetadata({ searchParams }: { searchParams?: Params }): Metadata {
  const seccion = seccionDe(searchParams);
  // Siempre sin consulta (lib/seo.ts): robots.txt deja fuera las variantes con `?`, así que las pestañas son la misma URL.
  const base = { alternates: canonica("/app/apoyar") };
  if (seccion === "aliados") {
    return {
      ...base,
      title: "Podio de aliados",
      description:
        "Quienes sostienen la vigilancia del dinero público, mes a mes. El podio se gana por constancia, no por plata, y no compra nada: nadie elige qué se lee ni qué se publica.",
    };
  }
  if (seccion === "aportes") {
    return { title: "Todos los aportes", description: "Cada aporte confirmado que sostiene la vigilancia del dinero público, con su recibo.", robots: NO_INDEXAR };
  }
  if (seccion === "costos") {
    return {
      ...base,
      title: "Cuánto cuesta Vigía",
      description: "Lo que cuesta mantener Vigía cada mes, rubro por rubro y con la fuente de cada cifra, y en qué se usa lo que aportas.",
    };
  }
  return {
    ...base,
    title: "Ayúdanos a seguir vigilando",
    description:
      "La corrupción se lleva carreteras, colegios y camas de hospital. Vigía cruza todos los días lo que compra el Estado y lee a fondo lo más grave. Hasta hoy lo sostuvimos nosotros: ayúdanos a seguir.",
  };
}

export const revalidate = 60;

/**
 * /app/apoyar: todo lo de sostener Vigía en UNA página con pestañas (`?seccion=`), pedido de la auditoría visual del
 * 2026-11-13 («los bloques de apoyo hasta tres veces», «saltar entre páginas»). Antes eran cuatro páginas con dos
 * entradas del menú: /app/apoyar (aportar), /app/aliados (el podio), /app/aliados/aportes (cada aporte) y
 * /app/cuanto-cuesta (las cuentas), y la meta del mes se repetía en tres. Las rutas viejas redirigen a su pestaña con
 * sus filtros (next.config.js).
 *
 *   Aportar             el por qué, el formulario fijo a la derecha, la meta, lo que pusimos y lo que no compra
 *   Podio de aliados    el podio y la tabla, por meses
 *   Todos los aportes   cada aporte con su recibo
 *   Cuánto cuesta       los rubros, la meta, la lectura con IA y mes a mes
 *
 * Las pestañas son enlaces (`VistasApoyo`): cada una tiene sus propios filtros y su paginación en la URL, y el servidor
 * pide sólo lo de la abierta. Ninguna lectura que falla queda en caché (`noStore` en cada sección).
 */
export default function ApoyarPage({ searchParams }: { searchParams?: Params }) {
  const seccion = seccionDe(searchParams);
  const pagina = Math.max(1, Number.parseInt(uno(searchParams?.pagina) ?? "1", 10) || 1);

  return (
    <Pagina className="space-y-4">
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Apoyar", href: HREF_APOYO.aportar },
          ...(seccion !== "aportar" ? [{ etiqueta: ETIQUETA_APOYO[seccion] }] : []),
        ]}
      />
      <EncabezadoPagina
        titulo="Ayúdanos a seguir vigilando"
        bajada="Vigía se sostiene con aportes de la gente: cómo aportar, quiénes lo hacen, cada aporte con su recibo y cuánto cuesta mantenerla."
        ayuda={
          <Ayuda titulo="¿Qué compra un aporte?">
            <span className="block">Nada: va al fondo común. Lo más grave se lee primero, aporte quien aporte, y lo que se encuentra se publica igual.</span>
            <span className="mt-2 block text-mute">Las reglas, en la pestaña Aportar.</span>
          </Ayuda>
        }
        acciones={
          seccion !== "aportar" ? (
            <EnlaceAccion href={`${HREF_APOYO.aportar}#aporte`} flecha>
              <HeartHandshake size={16} aria-hidden /> Aportar
            </EnlaceAccion>
          ) : undefined
        }
      />
      <VistasApoyo activa={seccion} />

      <div className="pt-1">
        {seccion === "aliados" ? (
          <SeccionAliados pagina={pagina} orden={uno(searchParams?.orden)} periodo={uno(searchParams?.periodo)} q={uno(searchParams?.q)} />
        ) : seccion === "aportes" ? (
          <SeccionAportes pagina={pagina} q={uno(searchParams?.q)} />
        ) : seccion === "costos" ? (
          <SeccionCostos />
        ) : (
          <SeccionAportar para={uno(searchParams?.para)} />
        )}
      </div>
    </Pagina>
  );
}
