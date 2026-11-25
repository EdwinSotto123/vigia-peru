# Cómo colaborar con Vigía

Gracias por querer sumarte. Vigía lee los contratos del Estado peruano para que cualquiera pueda vigilarlos, y mejora
cada vez que alguien encuentra un dato mal leído, propone una fuente nueva o arregla una pantalla.

*English summary at the end.*

## Formas de ayudar

| Si quieres… | Haz esto |
|---|---|
| Avisar de un dato o un dictamen equivocado | Abre un issue con la plantilla **Un dato no cuadra** y el enlace a la ficha |
| Proponer una fuente pública nueva | Abre un issue con la plantilla **Idea o fuente nueva** |
| Contar cómo usarías Vigía | Escribe en [Discussions](https://github.com/Gobserva-Cloud/vigia-peru/discussions) |
| Escribir código o documentación | Busca un issue con `good first issue` o `help wanted` y comenta que lo tomas |
| Reportar una vulnerabilidad | **No abras un issue**: sigue [SECURITY.md](SECURITY.md) |

## Reglas que no se negocian

Vigía publica datos de personas que trabajan en el Estado o le venden. Por eso, en el código, en los issues y en los PRs:

- **Nunca un DNI**, ni de funcionarios, ni de proveedores, ni de familiares. Tampoco un RUC 10 (el de una persona natural).
- **No se busca a una persona particular por su nombre**, y el apellido que Vigía tapa no se completa.
- **Una señal es un indicio para revisar, no una acusación.** Ningún texto puede decir que alguien cometió un delito.
- **Sólo datos públicos y oficiales**, con su fuente y su fecha. Nada que pida saltarse un captcha, un login o un
  límite del portal de origen.
- **Sin secretos en el repositorio**: claves, tokens y contraseñas van en variables de entorno.

Si un issue trae datos personales que no deberían estar, lo editamos o lo cerramos.

## Cómo funciona este repositorio

El desarrollo diario ocurre en un repositorio privado (allí están el CI y el despliegue) y **este repositorio público es
su espejo**: se publica con `infrastructure/github/publicar_github.sh`, que quita lo que no puede ser público y empuja
`main` sin reescribir lo ya publicado.

Por eso **los PRs no se fusionan aquí con el botón**. Así entra tu cambio:

1. Abres el PR en GitHub contra `main`.
2. Las pruebas corren solas (**Pruebas**: API y sitio).
3. Lo revisamos aquí, en el PR.
4. Cuando está aprobado, lo integramos en el repositorio de trabajo **con tu autoría** y sale en la siguiente
   publicación del espejo. El PR se cierra con el enlace al commit que lo trae.

`main` está protegida: sólo la actualiza el espejo, y no se puede borrar ni reescribir.

## Correrlo en tu máquina

Las instrucciones están en el [README](README.md#correrlo-en-tu-máquina). Para un cambio en la API o en el sitio basta
con Node 22:

```bash
cd backend/api && npm ci && npm run typecheck && npm test
cd frontend && npm ci && npx tsc --noEmit && npm test && node scripts/auditar-estilo.mjs
```

`auditar-estilo.mjs` es la guardia de estilo del sitio (tamaños de letra de la escala, sin «·» como separador, sin
voseo). Si una regla empeora, el script dice cuál y dónde.

## Cómo escribimos

- **Español del Perú, de tú**, en la interfaz, en los comentarios y en los mensajes de commit. Nombres de variables y
  funciones en español también.
- **Frases cortas y concretas.** Una cifra lleva su fuente y su fecha.
- **Cada cambio explica su porqué**: en el comentario del código cuando no es obvio, y en el mensaje del commit.
- **Pruebas** para lo que toca datos, topes o privacidad (`backend/api/test/`).
- **Accesible**: contraste suficiente, foco visible, nada que sólo se entienda por el color, y sin desborde horizontal a
  390 px de ancho.

## Licencia de tus aportes

Vigía se publica bajo la [PolyForm Noncommercial License 1.0.0](LICENSE). Al enviar un PR aceptas que tu aporte se
publique bajo la misma licencia. Te pedimos firmar tus commits con `git commit -s` (la línea `Signed-off-by`), que
declara que el aporte es tuyo y que puedes compartirlo.

## Convivencia

Este proyecto sigue un [código de conducta](CODE_OF_CONDUCT.md). Las dudas generales van en Discussions; lo demás, a
[hello@gobserva.cloud](mailto:hello@gobserva.cloud).

---

### English summary

Vigía reads Peruvian public procurement contracts so anyone can monitor them. This public repository is a **mirror** of
our private working repository, so pull requests are reviewed here but **merged on our side, keeping your
authorship**, and then published back to `main` (which is protected). Non-negotiable rules: never include national ID
numbers (DNI) or personal tax IDs (RUC 10), never search private individuals by name, signals are leads to review and
not accusations, public official data only (no captcha or login bypass), and no secrets in the repo. Run the API with
`cd backend/api && npm ci && npm test` and the site with `cd frontend && npm ci && npx tsc --noEmit`. Contributions are
licensed under PolyForm Noncommercial 1.0.0; please sign off your commits (`git commit -s`). Questions:
[Discussions](https://github.com/Gobserva-Cloud/vigia-peru/discussions) or hello@gobserva.cloud.
