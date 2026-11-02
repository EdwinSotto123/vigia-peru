# Correo de Gobserva (Lambda `vigia-gobserva-correo`)

La API (Worker de Cloudflare) no tiene llaves de AWS. Para mandar un correo, llama a esta Lambda por su URL con un token.
El rol de la Lambda solo puede enviar desde `@gobserva.cloud` por Amazon SES (us-east-2) y leer el estado de la cuenta
de SES.

```
Worker de la API ──POST {para, asunto, html, texto, baja}──▶ Lambda ──SendEmail──▶ SES ──▶ correo de la persona
                 ──GET──────────────────────────────────────▶ Lambda ──GetAccount─▶ ¿producción o sandbox?
```

- **Código**: `index.mjs`, que usa el SDK v3 que trae el runtime `nodejs22.x`.
- **Desplegar o actualizar**: `python infrastructure/aws/correo_gobserva/desplegar.py`, con el perfil `founder.edwin`
  (vigia-operador). Ese perfil puede crear roles `vigia*`, no usuarios IAM ni llaves de acceso.
- **Rotar el token**: el mismo comando con `--rotar`. Vuelve a cargar `CORREO_TOKEN` y `CORREO_URL` en el Worker, en
  producción y en dev.
- **Dónde quedan el token y la URL**: en SSM, `/vigia/gobserva/correo-token` y `/vigia/gobserva/correo-url`.
- **Sandbox**: mientras SES siga en sandbox, solo llega correo a direcciones `@gobserva.cloud`. La API lo sabe por el
  GET (`estadoCorreo()` en `backend/api/src/lib/correo.ts`). Lo demás queda en la bandeja de cada cuenta y en sus
  notificaciones.

## Salir del sandbox de SES

AWS rechazó la primera solicitud (caso 179357919400596). La API ya no deja pedirla de nuevo (`ConflictException`), y el
API de soporte exige un plan pagado. Hay que responder el caso desde la consola de AWS: Support Center → Your support
cases → el caso → **Reply**, con este texto.

> Thank you for reviewing our request. Here is more detail about how Gobserva (https://gobserva.cloud) sends email.
>
> Gobserva is a civic-tech platform in Peru that organizes official open data from the Peruvian state: public job
> openings (https://empleo.gobserva.cloud), public procurement calls (https://licitaciones.gobserva.cloud) and public
> works projects (https://obras.gobserva.cloud).
>
> **Who receives email.** Only people who created an account on our site and verified their email address through
> Firebase Authentication, which works as a double opt-in. We never send to unverified addresses, and we never buy,
> rent, scrape or import lists.
>
> **What we send.** Transactional email only, with no marketing campaigns:
> 1. Alerts the user created from a saved search, weekly by default or daily on paid plans. Example subject: "5 new
>    public job openings for 'lawyer' in Cusco". The body lists each item (title, public institution, closing date and
>    a link to the official government source) and has a footer with links to pause the alert and to manage the account.
> 2. A reminder two days before a saved opening closes, only for items the user saved.
> 3. Payment receipts and plan notices for paid subscriptions.
>
> **Unsubscribe.** Every alert email carries a one-click List-Unsubscribe header (RFC 8058) and a visible pause link.
> Users can pause or delete alerts, and delete their account from their profile, at any time.
>
> **Bounces and complaints.** The account-level suppression list is enabled for bounces and complaints, so we never
> retry a suppressed address. We review bounce and complaint rates in the SES console and stop sending to an address
> after a hard bounce or a complaint.
>
> **Volume.** 20 to 100 emails per day at launch, and under 500 per day over the next three months. Messages go out one
> at a time through a single Lambda function whose IAM role can only send from @gobserva.cloud.
>
> **Authentication.** The domain gobserva.cloud is verified with Easy DKIM, a custom MAIL FROM domain
> (mail.gobserva.cloud) with its own SPF record, and a DMARC record. The sender is alertas@gobserva.cloud and replies go
> to hello@gobserva.cloud. Privacy policy: https://vigia.gobserva.cloud/privacidad
