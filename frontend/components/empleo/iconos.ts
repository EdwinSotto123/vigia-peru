"use client";

/**
 * Los íconos que se repiten en cada tarjeta y cada fila de Gobserva Empleo, como componentes del navegador (el mismo
 * truco de components/ui/iconosCliente.ts): el server component manda `{"size":13}` en vez del SVG entero en cada una de
 * las 20 tarjetas de una página. El HTML que arma el servidor los trae igual. Quien busca trabajo lo abre con datos
 * móviles: cada kilobyte cuenta.
 */
export { BadgeCheck, Briefcase, Building2, Coins, Eye, GraduationCap, MapPin, Timer, Users } from "lucide-react";
