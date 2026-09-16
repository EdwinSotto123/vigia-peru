# Cuentas en Vigía Perú — sin cuenta vs. con cuenta

> Plan 2026-09-16 § U3 · migración `backend/db/migrations/26_cuentas.sql` · API `backend/api/src/routes/cuentas.ts` · frontend `lib/cuentas.ts`, `/app/mi-impacto`, `/app/configuracion`, `components/auth/UserMenu.tsx`.

**Principio:** la cuenta nunca es un peaje. Todo lo que hace Vigía (ver el mapa, leer contratos y señales, financiar una zona, denunciar) funciona **sin cuenta**. La cuenta solo **reúne** lo tuyo en un lugar y te deja seguir zonas.

| | Sin cuenta | Con cuenta (user-id + contraseña, sin correo obligatorio) |
|---|---|---|
| Mapa, contratos, señales, auditoría en vivo, aliados | Igual | Igual + chip **“Mis zonas”** (resalta las que sigues) y botón **“Seguir zona”** en el panel de zona |
| Financiar una zona | Como invitado: eliges cantidad, pagas (Yape/Plin/transferencia), recibes un código `VIG-…` y un **comprobante público** `/impacto/VIG-…`. Pedimos un correo (privado) para avisarte al validar. | El aporte se asocia a tu perfil de aliado: **no vuelves a escribir nombre, logo ni correo**; aparece en **Mi impacto** con su progreso en vivo. Un aporte hecho antes como invitado se puede asociar con código + correo usado. |
| Denunciar | Anónimo por defecto; opcionalmente dejas un correo | Igual; además la denuncia aparece en **Mi impacto** con su estado de moderación (en público sigue siendo anónima si así la enviaste) |
| Muro de aliados / ranking | Apareces con el nombre que diste al aportar (o “Anónimo”) | Eliges en **Configuración**: anónimo o visible, nombre público, logo y tipo (persona / empresa / organización). La página `/aliado/<slug>` es tuya. |
| Avisos | Correo al validar el pago (si lo dejaste) | Preferencias guardadas: “cuando se procese un contrato que financié” · “cuando haya señales en mi zona”. **Hoy solo se guarda la preferencia**; el envío de correos se activará más adelante. |
| Mis datos | El código `VIG-…` es tu única llave (guárdalo) | **Exportar** todo en JSON · **Borrar cuenta** con confirmación |

## Qué guardamos (tabla `usuarios`, 1:1 con Firebase Auth)

- `firebase_uid` (identidad; el user-id se guarda en Firebase como `displayName`; el correo sintético `user@vigia.local` nunca se muestra).
- `financiador_id` → perfil público de aliado en `financiadores` (nombre, tipo, logo, slug, visibilidad, RUC si es empresa). Se crea solo si aportas o si pides aparecer en el muro.
- `nombre_publico`, `visible` (¿aparecer en el muro?), `correo` (opcional, privado), `notificaciones` (jsonb de preferencias).
- `zonas_seguidas` (ubigeos) y `entidades_seguidas` (RUC).
- Lo que ya existía y se enlaza: `contribuciones` (tus aportes, públicos por diseño), `asignaciones` (contratos analizados con ellos) y `reportes_indexados.user_id` (denuncias con sesión).

**No guardamos** contraseñas (Firebase), ni DNI, ni datos de pago (el comprobante que subes va a un bucket privado que solo ve quien valida).

## Reglas

- **Un solo menú de usuario** (cabecera pública y pie del sidebar): *Mi impacto · Configuración · Salir*; sin sesión, *Entrar*. Nada más en la interfaz cambia con la sesión salvo “Mis zonas” y “Seguir zona” en el mapa, y la identidad prellenada al financiar.
- **“Crea una cuenta para seguir tu aporte”** se ofrece **después** del pago (pantalla de aporte registrado y comprobante), nunca antes.
- **Conflicto de interés** (empresa con sanción vigente o alertas activas): la cuenta puede pedir visibilidad, pero `financiadores.visible` se queda en `false` y Configuración lo explica. Los aportes procesan contratos igual.
- **Borrar cuenta** (`borrar_cuenta(uid)`): elimina la fila de `usuarios`, anonimiza el perfil de aliado (`nombre_publico`, `slug`, `logo_url`, `firebase_uid` → NULL; `visible=false`), quita el autor de tus denuncias y **conserva los aportes** (ya son públicos y financiaron análisis). La credencial de Firebase se borra desde el cliente (`deleteUser`).
- Endpoints: `GET/PUT/DELETE /cuentas/me`, `GET /cuentas/me/impacto`, `POST/DELETE /cuentas/me/seguir`, `POST /cuentas/me/reclamar`, `GET /cuentas/me/exportar`. Todos con `Authorization: Bearer <ID token>`.
