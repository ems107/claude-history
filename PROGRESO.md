# Plan: claude-history — navegador web local de conversaciones de Claude Code

> Archivo temporal de seguimiento: se actualiza en cada commit con el estado de la implementación y se elimina al terminar el proyecto.

## Estado de la implementación

- [x] Paso 1 — Scaffold: workspace pnpm, tipos compartidos, Fastify hello, shell Vite+Tailwind, CLAUDE.md
- [x] Paso 2 — jsonl/scanner/summarizer/projects/history + endpoints /api/sessions, /api/projects, /api/meta
  - Verificado contra datos reales: 44 sesiones, 7 proyectos (dirs con distinta mayúscula fusionados), 12 stubs vacíos, índice en ~50 ms.
  - Decisión: el proyecto de una sesión es su **primer** `cwd` (directorio de lanzamiento); el último puede haber cambiado a mitad de sesión.
  - Colores de tag: hue FNV-1a + ángulo áureo con resolución de colisiones (separación mínima 22°).
- [x] Paso 3 — SessionListPage (lista virtualizada, tags, fechas, orden, ocultar-vacías)
- [ ] Paso 4 — FilterSidebar + SortBar + estado en URL
- [ ] Paso 5 — cache.ts + enricher.ts + badges
- [ ] Paso 6 — search.ts + /api/search + SearchBox
- [ ] Paso 7 — parser.ts + /api/sessions/:id + SessionViewPage
- [ ] Paso 8 — ToolBlock + tool-results + thinking + TokenPanel
- [ ] Paso 9 — Subagentes (endpoints + drawer + enlaces Task)
- [ ] Paso 10 — live.ts + watcher.ts + SSE + badges LIVE
- [ ] Paso 11 — launcher.ts + resume endpoint + ResumeButtons
- [ ] Paso 12 — Modo producción + README + pulido
- [ ] Paso 13 — Extras opcionales (a demanda)

## Contexto

Edgar quiere una web localhost que muestre **todas** sus conversaciones de Claude Code de **todos** los proyectos (no solo la carpeta actual, como hace `/resume`), en una UI muy visual y funcional: listado ordenado de más reciente a más antiguo, tag de proyecto bien visible, filtros y ordenaciones, metadatos ricos, **visor completo de cada conversación**, **búsqueda de texto completo** y acciones de **reanudar sesión** (copiar comando + abrir Windows Terminal). Proyecto personal, independiente de PCCOM, en una carpeta nueva `C:\Users\Edgar\Git\.claude-history\` (con punto inicial, para distinguirla claramente de los clones de repos PCCOM) con su propio repo git. El repo debe incluir un **`CLAUDE.md` bien documentado** (en inglés).

Idiomas: este plan en español; **todo el código, comentarios, commits y README en inglés** (regla de CLAUDE.local.md). Textos de la UI en inglés.

## Hechos verificados del formato de datos (Claude Code 2.1.222, esta máquina)

La implementación DEBE respetar estas reglas, verificadas explorando `C:\Users\Edgar\.claude\`:

- **Transcripciones**: `~\.claude\projects\<dir-codificado>\<sessionUuid>.jsonl`. Hoy: 7 dirs de proyecto, 44 sesiones, 34 MB, archivo mayor 3,5 MB con líneas de hasta ~27 KB (los lectores por líneas deben tolerar líneas enormes).
- **Los nombres de dir codificados son IRREVERSIBLES** (`\ / . _ :` → `-`; la mayúscula de la unidad se conserva y el mismo proyecto puede partirse en dos dirs que solo difieren en mayúscula). **Nunca decodificar el nombre del dir**: la ruta real sale del campo `cwd` de las líneas de mensaje (o de `history.jsonl`). Agrupar proyectos por ruta real case-insensitive.
- **No existen líneas `type:"summary"`** (formato antiguo). Los títulos son líneas "sidecar" que se re-anexan continuamente: `custom-title`, `ai-title`, `agent-name`. Tomar la **última** aparición. Precedencia de título: `customTitle` → `aiTitle` → `agentName` → última `last-prompt.lastPrompt` (ya truncado a ~200 chars) → primer mensaje user con `content` string y sin `isMeta` → UUID.
- Otras líneas sidecar: `last-prompt`, `mode`, `permission-mode`, `bridge-session`, `queue-operation`, `file-history-snapshot` (su `snapshot.timestamp` en línea ~2 ≈ inicio de sesión), `file-history-delta`, `pr-link` (`prNumber`, `prUrl`, `prRepository` — badge).
- Líneas de mensaje (`user`/`assistant`/`system`/`attachment`): `uuid`, `parentUuid`, `timestamp` (ISO-8601 UTC), `cwd`, `sessionId`, `version`, `gitBranch`, `slug`, `promptId` (agrupa un turno), `isMeta` (filtrar para previews), `entrypoint` (`cli`/`claude-desktop`/`claude-vscode`), `sessionKind` (`"bg"` = background). Assistant añade `message.model`, `message.usage`, `effort`.
- **Deduplicar líneas assistant por `message.id` antes de sumar tokens** (los turnos streamed repiten el objeto `usage`). Excluir modelo `<synthetic>`.
- `user.message.content` es string (prompt real) o array (tool_result) — distinguir.
- **~80% de archivos: la primera línea NO tiene timestamp**. Inicio = primera línea con timestamp en head ~10; última actividad = última línea con timestamp en tail ~40; el mtime del archivo es proxy fiable para ordenar.
- **Head-10 + tail-40 líneas por archivo dan TODAS las columnas del listado** (título, fechas, rama, modelo, entrypoint, slug, nº mensajes aprox. vía `system`/`turn_duration.messageCount`, preview). El parseo completo solo hace falta para: totales de tokens, badges pr-link/ancestry, índice de búsqueda y el visor.
- **Ancestría de resume**: cada mensaje lleva `sessionId` (archivo dueño) y `session_id` (sesión origen); `distinct(session_id) − {uuid del archivo}` = cadena de ancestros.
- **Subagentes**: dir hermano `<sessionUuid>\subagents\agent-<17hex>.jsonl` + `.meta.json` (`agentType`, `description`, `toolUseId`, `spawnDepth`); `toolUseId` enlaza con el bloque `tool_use` de tipo Task del padre. `<sessionUuid>\tool-results\*.txt` guarda salidas de herramientas volcadas a disco ("Output saved to: …").
- **Extras globales**: `~\.claude\history.jsonl` (52 KB: cada prompt tecleado con texto completo, timestamp epoch-ms, ruta real de proyecto, sessionId) y `~\.claude\sessions\<pid>.json` (sesiones EN EJECUCIÓN: `sessionId`, `cwd`, `status` idle/busy, `pid` — validar vivacidad del pid con `process.kill(pid, 0)`).
- ~12/44 sesiones son stubs desechables (≤16 líneas, solo slash-commands, sin título) → ocultas por defecto.
- Envolver todo `JSON.parse` en try/catch (líneas corruptas/parciales; archivos activos se escriben mientras se leen). Resolver home con `os.homedir()` y raíz de datos configurable (`CLAUDE_CONFIG_DIR` / flag `--data-root`); no hardcodear rutas.

## Stack (decidido)

- **Backend**: Node 24 + **Fastify 5**, TypeScript ejecutado con **tsx** (sin build de servidor). Puerto **7433**, bind solo `127.0.0.1`.
- **Frontend**: **React 19 + Vite + TypeScript**, **Tailwind CSS v4** (`@tailwindcss/vite`), tema oscuro por defecto. Markdown con `react-markdown` + `remark-gfm` (sin `dangerouslySetInnerHTML`). Datos con **TanStack Query v5** + `EventSource` (SSE). Lista virtualizada con `@tanstack/react-virtual`.
- **Sin base de datos**: índice en memoria + caché JSON clave `(path, size, mtimeMs)` en `%LOCALAPPDATA%\claude-history\cache\`.
- **pnpm workspace** con 3 paquetes: `server`, `web`, `shared` (tipos TS compartidos consumidos como fuente, sin build).
- Scripts raíz: `pnpm dev` (server tsx watch :7433 + Vite :5173 con proxy `/api`), `pnpm build` (build de web), `pnpm start` (server sirviendo `web/dist` con `@fastify/static` + fallback SPA en :7433).

## Estructura del repo

```
.claude-history/
├── package.json, pnpm-workspace.yaml, .gitignore, README.md, CLAUDE.md, PROGRESO.md
├── shared/src/{index,types,api}.ts        # contratos API compartidos
├── server/src/
│   ├── main.ts, config.ts, app.ts
│   ├── core/
│   │   ├── jsonl.ts        # safeParse, headLines(n), tailLines(n), streamLines
│   │   ├── scanner.ts      # enumerar projects/*/*.jsonl + subagents + stat
│   │   ├── summarizer.ts   # head+tail → SessionSummary (títulos, fechas, badges)
│   │   ├── enricher.ts     # parseo completo en background: tokens, pr-link, ancestry, texto búsqueda
│   │   ├── parser.ts       # transcripción completa → SessionDetail (turnos, tool pairing)
│   │   ├── index.ts        # SessionIndex: orquestación scan → caché → enrich → SSE
│   │   ├── projects.ts     # agrupación por cwd real case-insensitive + color determinista
│   │   ├── history.ts      # lector de ~/.claude/history.jsonl
│   │   ├── live.ts         # ~/.claude/sessions/*.json + comprobación de pid vivo
│   │   ├── search.ts       # texto extraído cacheado + escaneo lineal en memoria
│   │   ├── cache.ts        # caché JSON (path,size,mtimeMs), escritura atómica debounced
│   │   └── watcher.ts      # fs.watch recursivo + debounce 300ms → refresh + SSE
│   ├── routes/  sessions, subagents, toolResults, search, projects, live, resume, events (SSE), meta
│   └── util/    launcher.ts (Windows Terminal + fallback cmd), debounce.ts
└── web/src/
    ├── main.tsx, App.tsx, api/{client,useEvents}.ts
    ├── pages/  SessionListPage, SessionViewPage, StatsPage (fase 5)
    ├── components/
    │   ├── list/    FilterSidebar, SortBar, SearchBox, SessionRow, LiveBadge, ProjectTag, Badges
    │   ├── viewer/  SessionHeader, TurnList, Turn, Markdown, ToolBlock, ThinkingBlock,
    │   │            SubagentDrawer, TokenPanel, ResumeButtons
    │   └── common/  Collapsible, RelativeTime, Spinner, EmptyState
    └── lib/  filters.ts, format.ts, projectColor.ts
```

## Backend — puntos clave

- **Pasada rápida (listado)**: por archivo, si hay hit de caché `(path,size,mtimeMs)` se reutiliza; si no, `summarizer` lee head-10 + tail-40 y extrae título (precedencia de arriba), fechas, `cwd`, rama, modelo, entrypoint, slug, nº mensajes aprox., preview y flag `isEmpty` (stub desechable). `hasSubagents` = existencia del dir `<uuid>\subagents`.
- **Enricher en background** (cola serie tras arrancar): parseo completo por sesión → tokens deduplicados por `message.id` y por modelo, badge `pr-link`, ancestría (`resumedFrom` + mapa inverso de descendientes), extracción de texto para búsqueda (`cache/text/<uuid>.json`). Cada sesión enriquecida emite SSE `session-updated` (los badges "aparecen" en la UI).
- **Parser del visor** (bajo demanda): agrupa turnos por `promptId` (fallback: partir en cada mensaje user string), empareja `tool_use` ↔ `tool_result` por `tool_use_id` en unidades plegables, detecta salidas volcadas a `tool-results/` y las convierte en referencias lazy-load, marca bloques `thinking`, lista subagentes desde los `.meta.json`.
- **API REST** (tipos en `shared/api.ts`): `GET /api/meta`, `/api/projects`, `/api/sessions` (todos los resúmenes; filtrado/orden en cliente), `/api/sessions/:id`, `/api/sessions/:id/subagents/:agentId`, `/api/sessions/:id/tool-results?name=`, `/api/search?q=`, `/api/live`, `POST /api/sessions/:id/resume`, `GET /api/events` (SSE: `sessions-changed`, `session-updated`, `live-changed`, `index-progress`, heartbeat 25 s).
- **Watcher**: `fs.watch` recursivo (soporte nativo Windows, sin chokidar) sobre `projects\`, `sessions\` y `history.jsonl`; debounce 300 ms; fallback a polling 30 s si `fs.watch` falla.
- **Búsqueda full-text**: texto extraído por sesión (títulos + prompts user string + bloques `text` de assistant deduplicados, más prompts de `history.jsonl` para sesiones aún no enriquecidas) cargado lazy en memoria y **escaneo lineal** con normalización case/diacríticos (NFD + strip; "código" encuentra "codigo"). Con este corpus responde en decenas de ms; frases exactas gratis. Ruta de mejora documentada: MiniSearch tras el mismo contrato `/api/search` si algún día se hace lento. Respuesta con snippets (`before`/`match`/`after`) y deep-link `?msg=<uuid>`.
- **Lanzador de terminal**: validar `:id` con regex UUID **y** pertenencia al índice; `cwd` SOLO del índice (nunca del request). Primario: `spawn("wt", ["-d", cwd, "--", "claude", "--resume", id], {detached, stdio:"ignore"})`; fallback `cmd /c start ... cmd /k claude --resume <id>`. El botón "copiar" es 100% cliente (`cd /d "<cwd>"` + `claude --resume <id>`, variante PowerShell).
- **Seguridad**: bind 127.0.0.1; endpoint de tool-results acepta solo nombre de archivo y verifica que la ruta resuelta quede dentro del dir `tool-results/` de esa sesión; la app **nunca escribe** dentro de `~\.claude` (solo lee); sus escrituras van a su propio dir de caché.

## Frontend — puntos clave

- **Listado** (`/`): sidebar de filtros plegable + barra de orden + búsqueda + lista virtualizada. Fila densa: `ProjectTag` coloreado (hue determinista por hash de la ruta; tooltip = ruta completa), título (2 líneas), badges (LIVE verde pulsante con idle/busy, PR, nº subagentes, resumed, background), columna derecha: tiempo relativo de última actividad (absoluto en hover), fecha de creación, nº mensajes, tamaño, chip de modelo, icono de entrypoint (terminal/escritorio/VS Code), rama.
- **Filtros** (cliente, memoizados): multi-select de proyecto con contadores, presets de fecha (hoy/7d/30d/rango), entrypoint, modelo, toggles de badges, "Ocultar sesiones vacías" **activado por defecto**. Estado de filtros en la URL (compartible).
- **Orden**: última actividad (defecto desc), creación, nº mensajes, tamaño.
- **Búsqueda**: debounce 300 ms; ≥2 chars pasa a modo resultados vía `/api/search` con snippets resaltados y deep-link a `/session/:id?msg=<uuid>`; por debajo, filtra títulos localmente. Nota "resultados parciales" mientras `indexComplete: false`.
- **Visor** (`/session/:id`): cabecera con título, tag, fechas, rama, slug, chips de ancestría (enlazan a la sesión ancestro si existe), botones de resume (lanzar deshabilitado con tooltip si el `cwd` ya no existe), panel de tokens. Turnos: burbuja de prompt del usuario → contenido assistant en markdown; `ToolBlock` plegado por defecto (cabecera: nombre de tool + resumen de input de una línea; expandir → input JSON + resultado clampado con "show all"; salidas volcadas → "Load full output"); `thinking` oculto salvo toggle global persistido en localStorage; drawer lateral para transcripciones de subagentes (mismo TurnList). Virtualizar turnos solo si >200.
- **Live**: hook `useEvents` (EventSource) invalida queries de TanStack; badge LIVE aparece/desaparece en ~1 s.

## Fases de implementación y commits progresivos

Repo nuevo: `git init` en `.claude-history/`, rama `main`, commits directos a `main` (proyecto personal, sin Jira ni PR). **Se harán commits progresivos cada vez que los cambios sean coherentes y compilen** (al final de cada paso numerado). Junto a cada commit se actualiza y commitea `PROGRESO.md`, que contiene inicialmente este plan completo y se actualiza en cada commit con el estado de la implementación; es temporal y se elimina al terminar el proyecto. Mensajes de commit en inglés.

**Fase 1 — Scaffold + scanner + listado (la app ya es útil):**
1. Workspace pnpm, tipos compartidos, Fastify hello + shell Vite con Tailwind oscuro, y primer `CLAUDE.md`. Commit.
2. `jsonl.ts` + `scanner.ts` + `summarizer.ts` + `projects.ts` + `history.ts`; endpoints `/api/sessions`, `/api/projects`, `/api/meta`. Verificar contra datos reales con curl. Commit.
3. SessionListPage: lista virtualizada, tags de proyecto, fechas, orden por defecto, ocultar-vacías. Commit.

**Fase 2 — Filtros, orden, caché, búsqueda:**
4. FilterSidebar + SortBar + estado en URL. Commit.
5. `cache.ts` + `enricher.ts` (tokens, pr-link, ancestry, extracción de texto) + badges en UI. Commit.
6. `search.ts` + `/api/search` + SearchBox con snippets y deep-links. Commit.

**Fase 3 — Visor de conversación:**
7. `parser.ts` + `GET /api/sessions/:id`; SessionViewPage con turnos + markdown. Commit.
8. ToolBlock (pairing/plegado) + endpoint tool-results + toggle thinking + TokenPanel. Commit.
9. Endpoints de subagentes + SubagentDrawer + enlace desde bloques Task. Commit.

**Fase 4 — Live + resume:**
10. `live.ts` + `watcher.ts` + SSE `/api/events` + badges LIVE + refresco automático. Commit.
11. `launcher.ts` + endpoint resume + ResumeButtons (copiar + lanzar con fallback). Commit.

**Fase 5 — Pulido + modo producción:**
12. `pnpm build`/`pnpm start` sirviendo estáticos, README, revisión final de `CLAUDE.md`, estados vacíos/error, resaltado de código, navegación con teclado (j/k, Enter, Esc). Commit.
13. Extras opcionales (abajo), cada uno su commit.

## CLAUDE.md del nuevo repo

Se crea en la Fase 1 y se mantiene actualizado en cada fase (en inglés). Contenido mínimo:

- Qué es el proyecto (navegador local de historial de Claude Code) y que es **independiente del ecosistema PCCOM**.
- Comandos: `pnpm install`, `pnpm dev` (server :7433 + Vite :5173), `pnpm build`, `pnpm start`; gestor de paquetes pnpm.
- Arquitectura: workspace `server`/`web`/`shared`, flujo scan → summarize → cache → enrich → SSE, dónde vive cada módulo.
- **Reglas del formato de datos de `~\.claude`** (la sección "Hechos verificados" de este plan, resumida): títulos sidecar con precedencia, head/tail, dedup de usage por `message.id`, no decodificar nombres de dir, `isMeta`, subagentes, etc. Es el conocimiento más valioso y el más fácil de perder.
- Restricciones: lectura solo de `~\.claude` (nunca escribir ahí), bind solo 127.0.0.1, validaciones del endpoint de resume, caché en `%LOCALAPPDATA%\claude-history\cache`.
- Cómo probar (sección de verificación resumida).

## Extras opcionales propuestos (fase 5+, a demanda)

- **Dashboard de estadísticas** (`/stats`): sesiones/tokens por día y proyecto, mix de modelos (datos ya indexados).
- **Cabeceras de agrupación** por día/proyecto en el listado.
- **Favoritos/pins** en un `userdata.json` propio (nunca toca `~\.claude`).
- **Exportar conversación a Markdown** (reutiliza el parser).
- **Estimación de coste** (usage × tabla de precios estática editable).
- **Vista de grafo de ancestría** (cadenas de resume/fork, ya calculadas).
- **Visor de cambios de archivos** (sidecars `file-history-snapshot`/`delta`: qué tocó cada sesión).
- **Botones "abrir en Explorer/VS Code"** (mismo patrón que el lanzador).
- **Biblioteca de prompts** sobre `history.jsonl` (todo prompt tecleado, buscable).

## Verificación (en esta máquina)

1. `pnpm install && pnpm dev` → `http://localhost:5173`: ~44 sesiones en ~6 grupos de proyecto (los dos dirs `OrchardCore-DistribWebAPI` que difieren en mayúscula deben fusionarse en un solo tag — test clave de agrupación case-insensitive).
2. Desactivar "Hide empty" → aparecen los ~12 stubs.
3. Abrir la sesión de 3,5 MB → el visor renderiza en <2 s, tool blocks plegados, panel de tokens con totales deduplicados.
4. Buscar una frase en español conocida con y sin tildes → hit con snippet; el deep-link hace scroll al mensaje.
5. Arrancar una sesión real de Claude Code → badge LIVE en ~1 s vía SSE, alterna idle/busy; matarla → el badge desaparece (chequeo de pid).
6. "Resume in terminal" en una sesión antigua → Windows Terminal se abre en el `cwd` correcto ejecutando `claude --resume <id>`; probar fallback sin `wt`; verificar que UUIDs desconocidos y paths forjados devuelven 4xx.
7. Reiniciar el servidor → arranque en caliente casi instantáneo desde caché (contadores en `/api/meta`).
8. `pnpm build && pnpm start` → misma app en `http://localhost:7433`; `netstat -ano | findstr 7433` muestra solo `127.0.0.1`.
