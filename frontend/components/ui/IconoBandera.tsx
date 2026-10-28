import type { LucideIcon } from "lucide-react";
import {
  Anchor, ArrowRightLeft, Ban, Banknote, Briefcase, CalendarPlus, CalendarRange, ChartPie, CircleMinus, CirclePause, CirclePlus,
  ClockAlert, Coins, Construction, Copy, DoorOpen, FileSearch, FileX, Flag, Footprints, Gauge, Gavel, GitFork, Handshake,
  HeartHandshake, IdCard, Landmark, Magnet, MapPinHouse, MapPinOff, Megaphone, Repeat, Replace, Ruler, Scissors, Split, Sprout,
  Swords, TrendingUp, UserRound, UsersRound, Vote, Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El ícono de cada tipo de bandera o señal, por familia: el mismo hecho lleva el mismo ícono en contratos, empresas,
 * personas, planilla y entidades (un aporte es un billete en todos lados). Acompaña al ícono de severidad, nunca lo
 * reemplaza: la severidad sigue diciéndose con su color, su forma y su palabra (`Severidad`).
 */
const POR_TIPO: Record<string, LucideIcon> = {
  // Política
  aporte: Banknote, aporte_empresa: Banknote, aporte_gobierna: Banknote, partido_gobernante: Banknote, financio_campana: Banknote,
  vendio_gobernante: Megaphone, proveedor_campana: Megaphone,
  candidato: Vote, candidato_gobierna: Vote,
  autoridad: Landmark, autoridad_contratada: Landmark, es_autoridad: Landmark,
  captura: Magnet,
  // En el proceso
  socio_comun: GitFork, unico_postor: UserRound, otro_postor: Replace,
  socio_en_entidad: ArrowRightLeft, funcionario_contratado: ArrowRightLeft,
  interes_declarado: Handshake, empleo_declarado: DoorOpen,
  domicilio_compartido: MapPinHouse,
  visita_previa: Footprints, visitas_clientes: Footprints,
  // Historial
  inhabilitado: Ban, penal: Gavel, sancion_multa: Gavel, inversion_laudo: Gavel, penalidad: CircleMinus,
  // Patrón
  fraccionamiento: Scissors, recurrente_dominante: ChartPie, proveedor_cautivo: Anchor, al_borde_del_tope: Gauge,
  // SUNAT
  dada_de_baja: FileX, suspendida: CirclePause, no_habida: MapPinOff,
  // Personas y planilla
  nepotismo: HeartHandshake, nepotismo_gobierno: HeartHandshake, familia_estado: HeartHandshake, pariente_locador: HeartHandshake,
  pariente_planilla: HeartHandshake, familiar_en_planilla: HeartHandshake, ascenso_expres: TrendingUp,
  meses_seguidos: CalendarRange, pago_alto: TrendingUp, brecha_cargo: TrendingUp,
  tambien_planilla: Split, tambien_ordenes: Split, doble_planilla: Copy,
  paso_a_planilla: IdCard, antes_locador: IdCard, planilla: IdCard,
  socio_proveedor: Briefcase, pago_extraordinario: Wallet, plazas: Ruler, gestion_saliente: DoorOpen, empresa_espejo: Copy,
  // Obra
  obra_controversia: Swords, obra_informe_control: FileSearch,
};

/** Las familias que se reconocen por el comienzo del tipo (las bandas de un mismo hecho). */
const POR_PREFIJO: [prefijo: string, icono: LucideIcon][] = [
  ["obra_paralizac", Construction], ["obra_paralizad", Construction], ["obra_atraso", ClockAlert], ["obra_pag", Coins],
  ["obra_adicional", CirclePlus], ["obra_plazo", CalendarPlus], ["inversion_sobrecosto", TrendingUp],
  ["recien_fundada", Sprout], ["sobreprecio", TrendingUp], ["adicional", CirclePlus], ["recurrente", Repeat], ["sancion", Ban],
  ["apellidos_", UsersRound],
];

export function iconoDeBandera(tipo: string): LucideIcon {
  return POR_TIPO[tipo] ?? POR_PREFIJO.find(([p]) => tipo.startsWith(p))?.[1] ?? Flag;
}

/** El ícono del tipo, decorativo (el nombre de la bandera va siempre en texto al lado). */
export function IconoBandera({ tipo, size = 13, className }: { tipo: string; size?: number; className?: string }) {
  const Icono = iconoDeBandera(tipo);
  return <Icono size={size} className={cn("shrink-0", className)} aria-hidden />;
}
