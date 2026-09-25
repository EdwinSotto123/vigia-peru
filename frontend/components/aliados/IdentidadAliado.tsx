import Link from "next/link";
import {
  Award,
  Building2,
  CalendarDays,
  CheckCheck,
  Coins,
  Flag,
  Globe,
  Hash,
  Landmark,
  Mail,
  MapPin,
  MapPinned,
  Receipt,
  Sprout,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";

/**
 * La identidad de un aliado, en piezas.
 *
 * Antes era una cadena de texto plano unida por puntos medios:
 *
 *   "Organización · aporta desde junio de 2026 · 3 aportes · 3 de las 25
 *    regiones con cola abierta"
 *
 * Cuatro datos distintos —de naturaleza distinta— pegados con un separador que
 * no es ni una coma ni una lista: el ojo tiene que parsear la línea entera para
 * sacar uno solo. Cada dato pasa a ser su propio elemento, con su ícono, que se
 * puede leer de un salto y escanear en columna cuando hay varios aliados.
 */

const ICONO = {
  "tipo-empresa": Building2,
  "tipo-persona": User,
  "tipo-organizacion": Users,
  fecha: CalendarDays,
  aportes: Receipt,
  regiones: MapPinned,
  zona: MapPin,
  entidad: Landmark,
  monto: Coins,
  codigo: Hash,
  senal: Flag,
} as const;

export interface DatoIdentidad {
  icono: keyof typeof ICONO;
  texto: React.ReactNode;
  /**
   * Explicación completa. Se abre en un Popover al tocar el dato (antes vivía en un
   * `title=""`, que no existe en pantallas táctiles ni con teclado).
   */
  titulo?: string;
}

const TAM_DATO = {
  sm: { texto: "text-[11px]", icono: 11 },
  md: { texto: "text-[13px]", icono: 13 },
} as const;

export function IdentidadAliado({
  datos,
  className,
  tam = "md",
  tono = "claro",
  as: Tag = "ul",
}: {
  datos: DatoIdentidad[];
  className?: string;
  tam?: keyof typeof TAM_DATO;
  /**
   * `oscuro` para superficies de marca (granate profundo, ink): `text-mute` está
   * calibrado para papel y sobre oscuro cae por debajo del mínimo AA.
   */
  tono?: "claro" | "oscuro";
  /**
   * `div`/`span` cuando el padre ya es una lista, o cuando está dentro de un
   * elemento en línea y un `ul` anidado sería HTML inválido.
   */
  as?: "ul" | "div" | "span";
}) {
  const t = TAM_DATO[tam];
  const Item = Tag === "ul" ? "li" : "span";
  const oscuro = tono === "oscuro";
  return (
    <Tag className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-1.5", t.texto, className)}>
      {datos.map((d, i) => {
        const Icono = ICONO[d.icono];
        return (
          <Item
            key={i}
            className={cn("inline-flex min-w-0 items-center gap-1.5", oscuro ? "text-paper/75" : "text-mute")}
          >
            <Icono size={t.icono} className={cn("shrink-0", oscuro ? "text-paper/60" : "text-mute/70")} aria-hidden />
            {d.titulo ? (
              <Popover
                titulo={typeof d.texto === "string" ? d.texto : undefined}
                anchoClase="w-72"
                className="min-w-0 truncate text-left underline decoration-dotted underline-offset-2 hover:decoration-solid"
                trigger={<span className="truncate">{d.texto}</span>}
              >
                {d.titulo}
              </Popover>
            ) : (
              <span className="truncate">{d.texto}</span>
            )}
          </Item>
        );
      })}
    </Tag>
  );
}

/* ── Insignias ─────────────────────────────────────────────────────────────
   Todas se DERIVAN de datos que el producto ya tiene. Ninguna se otorga a
   dedo: una insignia que no se puede recalcular desde la base es una medalla
   inventada, y en este producto eso vale lo mismo que una cifra inventada. */

export interface Insignia {
  clave: string;
  etiqueta: string;
  detalle: string;
  icono: "fundador" | "completo" | "alcance" | "limpio" | "veterano";
  /**
   * `marca` = granate (algo que dice quién es: capital semilla); `positivo` = moss
   * (un chequeo que pasó o un trabajo terminado); `neutro` = alcance y constancia.
   */
  tono: "marca" | "positivo" | "neutro";
}

const ICONO_INSIGNIA = {
  fundador: Sprout,
  completo: CheckCheck,
  alcance: MapPinned,
  limpio: ShieldCheck,
  veterano: Award,
} as const;

// Antes el tono positivo pintaba el chequeo de conflicto de interés con el maíz del
// renombre (maíz sobre claro no se lee, y el maíz es acento de marca, no "positivo"):
// lo que dice "pasó el chequeo" o "todo leído" es positivo, y positivo es moss (§3.7).
const TONO_INSIGNIA = {
  marca: "border-granate/30 bg-granate-soft text-granate",
  positivo: "border-moss/30 bg-moss/10 text-mossTexto",
  neutro: "border-line bg-paperSoft text-inkSoft",
} as const;

/**
 * Qué insignias le corresponden a un aliado, a partir de sus propias cifras.
 *
 * `mesesDesde` se calcula afuera para no meter `Date.now()` en el render de un
 * server component (dos renders darían dos resultados y React lo marca).
 */
export function insigniasDe({
  esFundador,
  financiados,
  leidos,
  regiones,
  regionesConCola,
  mesesAportando,
}: {
  esFundador: boolean;
  financiados: number;
  leidos: number;
  regiones: number;
  regionesConCola: number;
  mesesAportando: number | null;
}): Insignia[] {
  // Va primera porque es la única que aplica a todos y la única que dice algo
  // sobre el producto y no sobre el aliado: estar en el muro ES el chequeo.
  // Una empresa con sanción vigente puede aportar, pero no aparece acá.
  const out: Insignia[] = [
    {
      clave: "limpio",
      etiqueta: "Sin conflicto de interés",
      detalle:
        "Aparecer en este muro exige no tener sanción vigente del OECE ni alertas activas como proveedor. Quien no pasa ese chequeo puede aportar igual, pero no figura.",
      icono: "limpio",
      tono: "positivo",
    },
  ];

  if (esFundador) {
    out.push({
      clave: "fundador",
      etiqueta: "Capital semilla",
      detalle: "Puso el primer dinero para que la plataforma pudiera leer su primer contrato.",
      icono: "fundador",
      tono: "marca",
    });
  }

  if (financiados > 0 && leidos >= financiados) {
    out.push({
      clave: "completo",
      etiqueta: "Todo leído",
      detalle: `Los ${numero(financiados)} contratos que financió ya se leyeron: no queda ninguno esperando.`,
      icono: "completo",
      tono: "positivo",
    });
  }

  if (regiones >= 3) {
    out.push({
      clave: "alcance",
      etiqueta: `${regiones} regiones`,
      detalle: `Sus aportes cayeron en ${regiones} de las ${regionesConCola} regiones con cola abierta. Eligió las zonas, no los contratos: esos salen de la cola por antigüedad.`,
      icono: "alcance",
      tono: "neutro",
    });
  }

  if (mesesAportando !== null && mesesAportando >= 3) {
    out.push({
      clave: "veterano",
      etiqueta: `${mesesAportando} meses sosteniendo`,
      detalle: "Aporta de forma sostenida desde su primer contrato financiado.",
      icono: "veterano",
      tono: "neutro",
    });
  }

  return out;
}

/**
 * Función pura para no meter `Date.now()` en el render de un client component.
 * Del lado del servidor es seguro: estas rutas se revalidan cada 30 s, así que
 * no hay dos renders de la misma página con resultados distintos.
 */
export function mesesDesde(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24 * 30.44)));
}

export function Insignias({
  insignias,
  className,
  limite,
  tam = "md",
}: {
  insignias: Insignia[];
  className?: string;
  /** Cuántas caben acá. El muro muestra tres; la ficha, todas. */
  limite?: number;
  tam?: "sm" | "md";
}) {
  const visibles = limite ? insignias.slice(0, limite) : insignias;
  if (!visibles.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", tam === "sm" && "text-[11px]", className)}>
      {visibles.map((i) => {
        const Icono = ICONO_INSIGNIA[i.icono];
        // El detalle se abre al tocar la insignia (antes era un `title=""`: invisible en
        // pantallas táctiles y con teclado, y es justo lo que explica de dónde sale).
        return (
          <li key={i.clave}>
            <Popover
              titulo={i.etiqueta}
              anchoClase="w-72"
              className={cn("pill border", TONO_INSIGNIA[i.tono])}
              trigger={<><Icono size={11} aria-hidden />{i.etiqueta}</>}
            >
              {i.detalle}
            </Popover>
          </li>
        );
      })}
    </ul>
  );
}

/* ── Contacto ──────────────────────────────────────────────────────────────
   Le da al aliado lo que un reconocimiento público debería darle: un enlace a
   su propia página. Sólo se dibuja lo que existe; sin dato, no hay hueco. */

export function ContactoAliado({
  web,
  email,
  className,
}: {
  web?: string | null;
  email?: string | null;
  className?: string;
}) {
  if (!web && !email) return null;
  const host = web ? web.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]", className)}>
      {web && (
        <Link
          href={web}
          target="_blank"
          rel="noreferrer nofollow"
          className="inline-flex min-h-[24px] items-center gap-1.5 font-medium text-granate underline-offset-2 hover:underline"
        >
          <Globe size={13} aria-hidden /> {host}
        </Link>
      )}
      {email && (
        <a
          href={`mailto:${email}`}
          className="inline-flex min-h-[24px] items-center gap-1.5 text-inkSoft underline-offset-2 hover:text-ink hover:underline"
        >
          <Mail size={13} aria-hidden /> {email}
        </a>
      )}
    </div>
  );
}
