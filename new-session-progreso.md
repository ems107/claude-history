# Crear una sesión nueva desde la app

## Contexto

Hoy el composer solo sabe **continuar** conversaciones: `SessionChatService.spawnFor()` llama a
`query({ options: { resume: sessionId, cwd } })`, y tanto `sendBlockedReason()` como las rutas de
`server/src/routes/chat.ts` exigen que el id esté en el índice (`ctx.index.get(id)`), porque el `cwd`
sale de `summary.projectPath`. Por eso, para empezar algo nuevo hay que ir al terminal, y luego volver
a la app a leerlo.

El objetivo es cerrar ese hueco: elegir una carpeta, escribir el primer prompt desde la app y acabar en
el visor de siempre, con su indicador de trabajo, su composer, sus pills de coste y su transcripción.

Dos decisiones ya tomadas por el usuario:

- La carpeta se elige de la lista de proyectos **o se escribe a mano** (ruta absoluta). Esto es una
  excepción consciente a la regla dura «un `cwd` nunca viene de la petición, viene del índice», y hay
  que documentarla y validarla, no dejarla implícita.
- El punto de entrada es un **botón en la cabecera**, visible desde cualquier página.

Todo queda detrás de `chatEnabled`, igual que el composer: es la misma función y gasta la misma cuota.

## Rama

`edgar/new-session-composer`, saliendo de `main`. (Este repo no usa Jira; no hay `DES-XXXXX`.)

## La idea central: el *draft*

Claude Code genera el id de sesión al arrancar, pero el SDK acepta que se lo demos nosotros:
`Options.sessionId` (`server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1829`) —
*«Use a specific session ID for the conversation instead of an auto-generated one. Must be a valid
UUID. Cannot be used with `continue` or `resume`»*.

Eso permite conocer el id **antes** de que exista transcripción, que es lo que desbloquea todo lo demás:
el navegador puede montar el composer contra ese id y navegar al visor en cuanto el `.jsonl` aparezca.

Un **draft** es exactamente eso: un `{ id, cwd }` que el servidor reserva y que todavía no tiene fichero.
Vive solo hasta que `index.get(id)` responde; a partir de ahí la sesión es una sesión normal y todo el
camino existente (watcher → `rescan()` → `sessions-changed` → visor) funciona sin tocarlo.

## Servidor

### `shared/src/api.ts`

```ts
export interface ChatCreateRequest {
  /** Clave de proyecto de GET /api/projects — el servidor resuelve la ruta desde el índice. */
  projectKey?: string;
  /** Carpeta absoluta escrita por el usuario. La excepción documentada a la regla del cwd. */
  cwd?: string;
}
export interface ChatCreateResponse { sessionId: string; cwd: string }
```

Y `ChatStatus` gana un campo: `draft: boolean` — «hay proceso o reserva, pero todavía no hay
transcripción». Es lo que distingue un 404 real de una sesión que aún no ha nacido.

### `server/src/core/sessionChat.ts`

- `private readonly drafts = new Map<string, { cwd: string; createdAt: number; started: boolean }>()`.
- **`create({ projectKey, cwd })`** → `{ sessionId, cwd }`, sin arrancar nada:
  - respeta `chatEnabled` y `MAX_CHAT_SESSIONS` (mismo mensaje que `sendBlockedReason`);
  - con `projectKey`: la ruta sale de `this.index.projects()`, nunca de la petición;
  - con `cwd`: `trim()` → quitar comillas envolventes (`/^"(.*)"$/`, igual que `autoReloadCwd` en
    `index.ts:586`, porque «Copiar como ruta de acceso» de Windows las mete) → `path.isAbsolute` →
    `fs.statSync().isDirectory()`. Cada fallo con su propio mensaje;
  - `id = randomUUID()`, comprobando que no colisiona con `index.get(id)`.
- **`cwdFor(id)`**: `index.get(id)?.projectPath ?? drafts.get(id)?.cwd`. Es el único punto que cambia en
  `sendBlockedReason()` y en `spawnFor()`; la comprobación de dos escritores se queda como está (sobre un
  uuid recién creado no puede haber nadie).
- **`spawnFor()`**: una sola bifurcación en las opciones de `query()` —
  `...(fresh ? { sessionId } : { resume: sessionId })`, donde `fresh` significa «es un draft que todavía
  no ha arrancado nunca».
- **`knows(id)`**: `procs.has(id) || drafts.has(id)`. Lo usan las rutas.
- **`status()`** rellena `draft`.
- **`sweep()`** limpia drafts: los que ya están en el índice, y los que llevan >30 min sin proceso.
- **`pump()`**: si el primer mensaje trae un `session_id` distinto del que pedimos, dejarlo en
  `lastError` y en el log a nivel `error`. No debería pasar nunca, y si pasa es lo único que explica que
  el navegador se quede esperando una transcripción que se está escribiendo en otro sitio.

> **Un punto que hay que medir antes de fijarlo, no adivinar** (una línea de código según el resultado):
> ¿escribe Claude Code el `.jsonl` al arrancar el proceso, o en el primer turno? Decide dónde se marca
> `started`: en `spawnFor()` (si el fichero ya existe al arrancar, un reinicio posterior debe usar
> `resume`) o en `write()` (si no existe, un reinicio antes del primer prompt debe volver a usar
> `sessionId`). Solo importa en un camino: `open()` arranca el CLI sin prompt para leer la lista de
> modelos, y cambiar el *effort* después reinicia el proceso (`sessionChat.ts:383`). Se comprueba
> arrancando un draft y mirando `~/.claude/projects/<slug>/` antes de enviar nada.

### `server/src/routes/chat.ts`

- **`POST /api/chat/new`** → `ctx.chat.create(body)`. 400 si la validación de la carpeta falla, 409 para
  lo que refleja `sendBlockedReason` (apagado, demasiadas sesiones). Ya está cubierto por el hook global
  `isSameOrigin` de `app.ts`, como cualquier POST.
- En las cinco rutas existentes, `if (!ctx.index.get(id))` pasa a
  `if (!ctx.index.get(id) && !ctx.chat.knows(id))`. Es el cambio que deja al composer hablar con una
  sesión que todavía no tiene fichero.

No hace falta tocar `localOnly.ts`: el composer nunca fue local-only, y crear una sesión no abre ninguna
ventana en el escritorio del servidor.

## Web

### `web/src/api/client.ts`

`chatCreate(body: ChatCreateRequest)`, con el mismo patrón de error que `chatSend`.

### `web/src/pages/NewSessionPage.tsx` — ruta `/new` (nuevo)

Existe solo hasta que hay transcripción; en cuanto la hay, cede el sitio al visor. Así
`SessionViewPage` no se toca en absoluto.

- Con `chatEnabled` en `false`: un aviso con enlace a Ajustes y nada más.
- **Selector de carpeta**: un `<select>` con `ProjectInfo` (nombre + ruta; `/api/projects` ya viene
  ordenado por actividad) más una opción `Otra carpeta…` que abre un campo de texto. La última elección
  se recuerda en `localStorage` (`ch:newSessionProject`).
- Al fijar la elección → `POST /api/chat/new` → `draftId`. Cambiar de carpeta crea otro draft; el
  anterior no arrancó nada y lo barre `sweep()`.
- **Reutiliza `Composer`** con `sessionId={draftId}` y `lastModel/lastEffort/lastMode` a `null` — no hay
  nada que continuar, así que el composer ya cae en su propio camino de «choose model…». Con él vienen
  gratis el panel de preguntas, el modo plan, los comandos `/` y el botón de parar.
- **Eco y espera**: `PendingTurn` + `WorkingIndicator`, montados igual que en
  `SessionViewPage.tsx:485-499`.
- **Traspaso**: `useQuery({ queryKey: ['session', draftId], enabled: sent, retry: false })`. Es
  exactamente la clave que `useEvents` invalida con `sessions-changed`, así que el SSE la despierta sola;
  un `refetchInterval` corto queda de red de seguridad. En cuanto responde →
  `navigate('/session/' + draftId, { replace: true })`. **Solo después de haber enviado un prompt**
  (`sent`), para que abrir el CLI con «choose model…» no salte de página con la caja vacía.

### `web/src/components/viewer/Composer.tsx`

Un solo cambio: `columnWidth` pasa a ser opcional. Ese `max()` de la fila de acciones
(`Composer.tsx:398`) existe para que `Send` no quede debajo de la píldora de «seguir el final»; en
`/new` no hay píldora, y sin prop la fila usa su `pr-2` de siempre.

### `web/src/App.tsx`

- `<Route path="/new" element={<NewSessionPage />} />`.
- Entrada en la cabecera, delante de `Prompts`, visible solo con `chatEnabled` (`['settings']` ya está
  montado por `UsageWidget`, así que no cuesta ninguna petición extra).

## Documentación

- **`docs/AI_RUNNING_CLAUDE.md`** — apartado nuevo bajo «The composer»: qué es un draft, por qué el id se
  acuña aquí (`sessionId` en vez de `resume`), el traspaso al visor, y la excepción del `cwd` escrito a
  mano con su validación. También la respuesta a la medición de `started`, que es justo el tipo de hecho
  empírico que este repo guarda.
- **`docs/AI_ARCHITECTURE.md`** y **`CLAUDE.md`** — reescribir la invariante «A path or a cwd never comes
  from the request» para que nombre la única excepción y lo que se le exige, en lugar de dejar la regla
  diciendo algo que ya no es cierto.
- **`docs/AI_TESTING.md`** — **check 37** (los números son históricos, el último es el 36), y actualizar
  «the 36 checks» de `CLAUDE.md`.

## Verificación

Aplican primero las **dos reglas de cualquier check que ejecuta Claude** (`AI_TESTING.md`): `haiku` o
`sonnet` con effort `low`, y nunca matar procesos filtrando por `claude.exe` — anotar el pid y matar ese.

1. `pnpm typecheck`, `pnpm build`, `.\dev.ps1 -Restart -NoBrowser`, y `/api/meta` respondiendo
   `devInstance: true`. **Dejar la instancia dev viva al terminar.**
2. **Servidor con curl** (mismo patrón que el check 19):
   - `POST /api/chat/new` con `projectKey` → `{ sessionId, cwd }` y el `cwd` es el del índice;
   - con `cwd` a mano: una carpeta real → 200; una ruta relativa, una que no existe, un fichero en vez de
     carpeta y una entrecomillada al estilo Windows → cada una con su mensaje;
   - `Sec-Fetch-Site: cross-site` → 403;
   - `GET /api/sessions/<draft>/chat` → 200 con `draft: true` (hoy sería 404);
   - `POST /api/sessions/<draft>/chat` con el primer prompt → el estado pasa `starting` → `working` →
     `idle`, y aparece **un `.jsonl` nuevo con exactamente ese uuid** en la carpeta del proyecto. Ese es
     el assert que prueba que `options.sessionId` se respeta;
   - `draft` pasa a `false` cuando el índice lo recoge;
   - con `chatEnabled` apagado, `POST /api/chat/new` se niega con la razón.
3. **Navegador**: cabecera → `/new` → elegir proyecto → escribir un prompt → el eco aparece, el indicador
   se enciende, y la página salta sola a `/session/<id>` con la respuesta ya renderizándose desde la
   transcripción. Repetir con `Otra carpeta…` sobre una carpeta que **no** esté en el índice: debe
   aparecer como proyecto nuevo en la lista y en los filtros.
4. **Modo plan en el primer prompt**, que es donde más se usa: elegir `plan` antes de enviar, provocar un
   `ExitPlanMode` y comprobar que el panel se dibuja (el caso de `/new` es el único en que el picker de
   modo trabaja sin CLI arrancado).
5. **Sin huérfanos**: anotar el pid del `claude.exe` arrancado, `pnpm stop`, y comprobar que ese pid ya no
   está y que los demás siguen.
6. **La regla que no se puede olvidar**: si esta conversación llega por el composer, reiniciar el
   servidor que la sirve la mata. La sesión del composer vive en la release del 7433, que nada de este
   repo reinicia; aun así, comprobar `GET /api/sessions/<id>/chat` antes de tocar un puerto.

## Commits

Se irá haciendo commits progresivos según el cambio quede coherente y compile, y junto a cada commit se
actualiza un `new-session-progreso.md` con el estado de la implementación (empieza conteniendo el plan
entero). Ese fichero es temporal y se borra a mano antes de cerrar el trabajo.

Orden previsto:

1. Tipos en `shared` + drafts y `create()` en `sessionChat.ts` + rutas. Verificable entero con curl.
2. `NewSessionPage`, la ruta y el botón de cabecera, y el `columnWidth` opcional del composer.
3. Documentación (`AI_RUNNING_CLAUDE.md`, `AI_ARCHITECTURE.md`, `CLAUDE.md`, check 37).

**No se corta release**: `pnpm release` solo cuando lo pidas explícitamente.

---

## Estado de la implementación

> Fichero temporal. Se borra a mano antes de cerrar el trabajo.

- [x] 1. Tipos en `shared` + drafts y `create()` en `sessionChat.ts` + rutas
- [x] 2. `NewSessionPage`, ruta `/new`, botón de cabecera, `columnWidth` opcional
- [ ] 3. Documentación (`AI_RUNNING_CLAUDE.md`, `AI_ARCHITECTURE.md`, `CLAUDE.md`, check 37)

### Medido, no supuesto

- `Options.sessionId` **se respeta**: la transcripción aparece en
  `~/.claude/projects/<slug>/<uuid>.jsonl` con exactamente el uuid que acuñamos, incluso en una carpeta
  que Claude Code no había visto nunca (se crea el proyecto nuevo).
- **Claude Code no escribe nada al arrancar el proceso, solo en el primer turno.** Un `chat/start` sobre
  un draft deja 0 ficheros. Por eso `spawnFor()` no lleva bandera `started`: pregunta al disco
  (`transcriptExists`), que es la única fuente que acierta en los dos momentos — incluido el reinicio por
  cambio de *effort* antes del primer prompt, que vuelve a usar `sessionId` y acaba en el mismo uuid.
- El `session_id` de los mensajes del SDK coincide siempre con el pedido; la guarda de `pump()` no ha
  saltado nunca.

### Verificado con curl (instancia dev, 7434)

`chatEnabled` off → 409 con la razón · cross-site → 403 · `projectKey` desconocida, ruta relativa,
carpeta inexistente, fichero en vez de carpeta y cuerpo vacío → 409 cada una con su mensaje · ruta
entrecomillada estilo Windows → 200 · `GET /api/sessions/<draft>` 404 mientras `GET .../chat` responde
200 con `draft: true` · primer prompt → transcripción con ese uuid, `draft` pasa a `false` · dos prompts
seguidos → `queued: 1` y en orden, un solo `.jsonl` con 3 turnos · `chat/stop` no deja huérfanos (pids de
`claude.exe` idénticos antes y después).

### Verificado en Chrome (CDP)

Botón `+ New` en la cabecera → `/new` → 19 proyectos en el desplegable más `Another folder…` → una ruta
relativa se rechaza con su frase al lado de la caja y la página no avanza → una carpeta nueva de verdad
reserva el id y aparece el composer → primer prompt: eco `sending…`, indicador de trabajo encendido →
salto solo a `/session/<id>` con la respuesta ya dibujada desde la transcripción (2 `[data-bubble]`, el
composer del visor al pie). Sin huérfanos de `claude.exe`.

### Modo plan en el primer prompt

Sesión creada directamente en `plan`: el estado lo refleja desde el primer instante (`permissionMode:
plan` con `state: starting`), y llega un `ExitPlanMode` real con el plan leído de
`~/.claude/plans/<slug>.md` (460 caracteres, markdown). *Keep planning* con nota se acepta. Es el caso
que solo existe aquí: el picker de modo trabajando sin ningún CLI arrancado.
