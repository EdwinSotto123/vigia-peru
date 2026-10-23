"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";

/**
 * El panel lateral del dossier de contrato: al hacer clic en una orden, un cruce o un dato, se abre un drawer a la
 * derecha (en el celular, una hoja desde abajo) con el detalle, SIN salir de la pestaña. Así el usuario explora sin
 * perder dónde estaba. Se apoya en `Panel` (el <dialog> nativo del kit: foco atrapado, Escape, clic afuera, scroll
 * lock y animación gratis); acá sólo va el estado compartido y el cuerpo con forma de ficha.
 *
 * Uso: envolver el dossier con <DossierDrawerProvider> (ya hecho en ContratoDetalle) y, desde cualquier componente
 * CLIENTE de adentro, pedir el drawer con el hook:
 *
 *   const { abrir } = useDossierDrawer();
 *   <button onClick={() => abrir({
 *     titulo: "Orden O/C-01234567-2026",
 *     descripcion: "Devengada",
 *     filas: [
 *       { k: "Entidad", v: "Municipalidad de Calca" },
 *       { k: "Monto", v: "S/ 36,709" },
 *     ],
 *     verContratoHref: "/app/contratos/2021-169663-75",  // opcional: botón "Ver contrato entero"
 *   })}>…</button>
 *
 * `titulo`, `descripcion`, `filas[].v` y `cuerpo` son ReactNode: el que abre (un componente cliente) arma el contenido.
 */
export interface DetalleDrawer {
  titulo: string;
  /** Línea de contexto bajo el título (estado de la orden, fecha, etc.). */
  descripcion?: ReactNode;
  /** Pares clave → valor, como "Datos del proceso": lo más común. */
  filas?: { k: string; v: ReactNode }[];
  /** Contenido libre debajo de las filas (una tabla, un texto largo). */
  cuerpo?: ReactNode;
  /** Si el detalle pertenece a un contrato con ficha propia: botón "Ver contrato entero". */
  verContratoHref?: string;
  /** Ancho del drawer; por defecto "md". */
  ancho?: "sm" | "md" | "lg" | "xl";
}

interface DrawerAPI {
  /** Abre el drawer con un detalle. */
  abrir: (detalle: DetalleDrawer) => void;
  /** Lo cierra. */
  cerrar: () => void;
}

const DrawerCtx = createContext<DrawerAPI | null>(null);

/** Hook para abrir/cerrar el drawer desde un componente cliente dentro del dossier. */
export function useDossierDrawer(): DrawerAPI {
  const api = useContext(DrawerCtx);
  if (!api) throw new Error("useDossierDrawer() se usó fuera de <DossierDrawerProvider>");
  return api;
}

export function DossierDrawerProvider({ children }: { children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  // `detalle` NO se limpia al cerrar: así el contenido sigue visible mientras el panel se desliza hacia afuera.
  const [detalle, setDetalle] = useState<DetalleDrawer | null>(null);

  const abrir = useCallback((d: DetalleDrawer) => {
    setDetalle(d);
    setAbierto(true);
  }, []);
  const cerrar = useCallback(() => setAbierto(false), []);
  const api = useMemo<DrawerAPI>(() => ({ abrir, cerrar }), [abrir, cerrar]);

  return (
    <DrawerCtx.Provider value={api}>
      {children}
      <Panel
        abierto={abierto}
        onCerrar={cerrar}
        titulo={detalle?.titulo ?? ""}
        descripcion={detalle?.descripcion}
        posicion="lateral"
        ancho={detalle?.ancho ?? "md"}
        pie={
          detalle?.verContratoHref ? (
            <EnlaceAccion href={detalle.verContratoHref} flecha className="w-full">
              Ver contrato entero
            </EnlaceAccion>
          ) : undefined
        }
      >
        {detalle && <CuerpoDrawer d={detalle} />}
      </Panel>
    </DrawerCtx.Provider>
  );
}

function CuerpoDrawer({ d }: { d: DetalleDrawer }) {
  return (
    <div className="space-y-4">
      {d.filas && d.filas.length > 0 && (
        <dl className="space-y-3">
          {d.filas.map((f, i) => (
            <div key={i}>
              <dt className="text-rotulo text-mute">{f.k}</dt>
              <dd className="mt-0.5 text-dato leading-5 text-ink">{f.v}</dd>
            </div>
          ))}
        </dl>
      )}
      {d.cuerpo}
    </div>
  );
}
