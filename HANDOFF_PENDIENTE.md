# Luxury Finds — Estado del proyecto y traspaso (actualizado 2026-10-04, tarde)

Documento pensado para que **otra IA o persona retome el proyecto sin releer todo**. Léelo completo antes de tocar código. Todo lo marcado "verificado" se comprobó contra la base real o producción en la fecha indicada.

- Repo: `lizsoriano/luxuryfinds` (rama de trabajo habitual `feature/appluxury2`; `main` = producción).
- Producción: https://luxuryfinds.vercel.app (dominio propio https://www.luxuryfinds.com.mx).
- Stack: app Next-like sobre **`vinext` + `vite` + React Server Components** (NO es Next.js estándar), deploy en Vercel con `nitro`; **sin Tailwind**, CSS plano en `app/globals.css`; backend **Supabase** (proyecto `vjkmnobsodrcwcsotbry`, schema `luxury_finds`).
- La dueña: Ruth Elizabeth Soriano (boutique de belleza en La Paz, BCS; compra en EE.UU. con "shopper" y vende por pedido y entrega inmediata). Habla español; responde siempre en español.

---

## 1. Reglas de oro (aprendidas a golpes — respétalas)

1. **Nadie puede ejecutar SQL desde el código ni desde un agente.** No hay runner de migraciones, ni `DATABASE_URL`, ni `psql`. La app solo tiene la service key de PostgREST (no hace DDL). **Las migraciones las corre la dueña a mano** en el editor SQL de Supabase. Un agente solo escribe el archivo en `database/migrations/NNN_*.sql` y le pasa el SQL.
2. **Todo código que dependa de una migración nueva debe degradar con gracia mientras no exista** (avisos que nombran el archivo, el resto del sitio idéntico). Patrón en `lib/supabase/admin-quotes.ts`, `admin-catalog.ts` (008/009), `admin-purchases.ts` (010). Cuando ella corre la migración todo se activa **sin redeploy**.
3. **Verifica contra datos reales, no solo "compila".** Scripts Node desechables con `SUPABASE_SECRET_KEY` (parsea `.env` a mano, no hay dotenv). Datos de prueba con prefijo `TEMP-` y **bórralos siempre** (orden FK-seguro: movimientos → imágenes → variantes → productos). Para lógica que necesita tablas que aún no existen en la base real, usa **PGlite** (Postgres en WASM) instalado en un scratchpad, **nunca** en `package.json`.
4. **Nunca escribas contraseñas en formularios** (ni siquiera la de la dueña). Para ver el panel admin usa un **harness HTML estático temporal** en `public/` con el markup real + copia de `app/globals.css`, y bórralo al terminar. `git status --short` limpio al final.
5. **No toques datos reales** al probar: ~4,580 productos, 402 de Bath & Body Works (`internal_code` `BBW-…`, ocultos, a $0 esperando precio), clientas reales, `app_settings`.
6. **Flujo de git por cambio:** commit → push → `gh pr create --base main` → `gh pr checks <N>` hasta que Vercel pase → `gh pr merge <N> --merge` → confirmar `gh api repos/lizsoriano/luxuryfinds/commits/<sha>/status --jq '.state'` = `success`. Nunca fusionar con build fallido. Antes de editar: `git fetch && git pull`.
7. **Trabajo en paralelo:** si dos agentes/IAs trabajan a la vez, **cada uno en su propio `git worktree` y su propia rama** (`git worktree add -b feature/x ../dir origin/main`; hay que `npm ci` y copiar `.env`). `app/globals.css` son reglas minificadas, **una por línea**: agrega lo tuyo **al final** y resuelve conflictos línea por línea. Reserva un rango de números de migración por quien trabaje.
8. Dinero siempre en **centavos enteros** (`bigint`); aritmética con enteros/BigInt, redondeo **una sola vez al final** (ver `lib/supabase/store-cost.ts`, `purchase-math.ts`).
9. Avisar antes de acciones destructivas o visibles para otros (el merge a `main` dentro del flujo normal está permitido; borrar datos reales, no).

## 2. Lecciones técnicas específicas

- **Para saber si una tabla/migración existe, haz un GET crudo** (`/rest/v1/<tabla>?select=*&limit=1` con `Accept-Profile: luxury_finds`; una tabla ausente da 404 `PGRST205`). **NO uses `select(..., {head:true})` de supabase-js: puede devolver "ok" para tablas que no existen** (nos dio un falso "aplicada" para 010/011/013).

- **vinext/Vercel:** el plan Hobby solo admite cron **1 vez al día**; el bloque `functions` en `vercel.json` rompe el build (nitro lo gestiona). Duración de función ~60 s.
- **Variables de entorno en Vercel por ambiente:** una variable puede tener filas separadas por ambiente (Production/Preview/Development); si algo funciona en producción pero no en un preview, revisa que la fila exista para **Preview**.
- **PostgREST:** `.in()` con cientos de UUID genera URLs enormes (400) → procesa por lotes (150). `.or()` con `id.in.(…)` intenta castear todo a uuid (error 22P02): separa por forma del valor. Un `select()` sin paginar corta en **1,000 filas**. Falta de índice en `product_images.product_id` hacía lenta la lista (migración 005).
- **Búsquedas/formularios:** usar rutas absolutas (`action="/catalogo"`), nunca `"."` (resuelve a la raíz).
- **Telegram:** webhook con `secret_token`; ya registrado en `https://www.luxuryfinds.com.mx/api/telegram/webhook` (verificado). Bot `@LuxuryFindsMx_bot`.
- **Servidor rechaza cuerpos > 1 MB** en server actions (visto en la Fase 1 de compras): las fotos de celular se **comprimen en el cliente** (`app/admin/compras/compress-photo.ts`, JPEG ~1600 px ≤ ~850 KB). El formulario de Productos acepta "hasta 5 MB" pero probablemente falla > 1 MB: **pendiente de verificar/arreglar** (config de tamaño de body o compresión en cliente).
- Error de dev server `Cannot read properties of undefined (reading 'import')` (vite-rsc): preexistente, no aparece en el build de producción.
- `npm test` (`tests/rendered-html.test.mjs`) está roto de antes (busca un texto viejo de `/catalogo`). No bloquea el deploy.
- Imágenes de catálogo: bucket público `oskinmx-catalog` (clave `<productId>/<uuid>.<ext>`); recibos y fotos de tickets de compra: bucket **privado** `expense-receipts` (URL firmada corta).

## 3. Variables de entorno (8) — todas confirmadas funcionando en Vercel

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `SYNC_CRON_SECRET`, `REFUND_ENCRYPTION_KEY` (la última no se ha ejercitado con datos reales: Devoluciones sin probar). Marcadas "Sensitive" las secretas. El `.env` local nunca se commitea.

## 4. Cuentas

- Administradora (OWNER) real: usuario `ruth`, correo `rutilia2511@gmail.com` (la contraseña la tiene ella).
- Clientas reales hoy: 2 (Ruth Elizabeth Soriano —también admin— y Marcela Guerra).
- Acceso "Solo mi celular" (`/login`, pestaña): pensado para clientas, **bloquea cuentas de `admin_users`**; requiere habilitar **Phone** en Supabase Auth (Authentication → Providers → Phone). **Pendiente confirmar que la dueña lo activó** (la última comprobación seguía con `Phone logins are disabled`).

## 5. Migraciones (`database/migrations/`)

| N.º | Archivo | Qué hace | Estado en la base real (verificado 2026-10-04) |
|---|---|---|---|
| 000–006 | grants, telegram, negocio/POS (002), sync (003), plan semanal (004), índice imágenes (005), favoritos (006) | base del admin/POS/sync | aplicadas |
| 007 | `quotes` | Cotizaciones | aplicada |
| 008 | `products.in_transit` | "Productos en camino" | aplicada |
| 009 | `product_variants.store_cost_usd_cents`, `commission_percent` + `app_settings.us_tax_factor` | costo tienda USD → costo MXN | aplicada |
| 010 | `purchases`, `purchase_tickets`, `purchase_items`, `shopper_payments`, triggers, `confirm_shopper_purchase()` | Compras con shopper, Fase 1 | aplicada |
| 011 | `purchase_assignments`, vista `purchase_item_availability`, `assign_purchase_item()`, `cancel_purchase_assignment()` | Compras con shopper, Fase 2 | aplicada |
| 012 | `admin_users.role` ('OWNER'/'EMPLOYEE') + `phone` | roles del panel de empleado | aplicada |
| 013 | `delivery_confirmations(+items)`, `confirm_staff_delivery()`, columnas de `payment_proofs`, `inventory_movements.evidence_storage_key`, GRANT sobre `payments` | confirmar entregas del empleado | aplicada |
| 014 | `shipments`, `shipment_lines`, `shipment_receipts`, vistas `purchase_item_shipping`/`shipment_overview`, funciones `create_shipment`…`receive_shipment` | Compras con shopper, Fase 3 (embarques y recepción) | aplicada |
| 020 | `delivery_bookings.visit_id/confirmed_at/confirmed_by_admin_id/rejected_at/rejected_by_admin_id`, trigger `trg_delivery_bookings_visit` + índice `uq_delivery_slot_visit_leader` (sustituyen a `uq_delivery_slot_active`), `confirm_delivery_request`, `reject_delivery_request`, nuevas `client_book_delivery`/`client_cancel_delivery` | "Solicitudes por confirmar": la clienta aparta UNA ventana de 10 min por visita y solo la dueña la confirma (Agenda). Sin ella, todo sigue como 019. Pruebas: `tests/delivery-requests.pglite.mjs` | pendiente de aplicar (2026-10-08) |

**Todas las migraciones 000–014 están aplicadas** (verificado con GET crudo el 2026-10-04). **Siguiente número libre: 015.** Si se vuelven a correr en otra base, el orden es 010 → 011 → 012 → 013 → 014 (cada una se detiene sola si falta una anterior). No renumeres migraciones ya fusionadas.

## 6. Módulos — estado

**Sitio público (`app/(public)`)**: home, catálogo (búsqueda, pestañas Todo / Entrega inmediata / Por pedido / Sephora Favorites / Perfumes / Blushes / Labiales / Bases / Correctores, paginación numerada), detalle de producto, carrito sin sesión (localStorage) + checkout que exige cuenta, crear cuenta, login (correo+contraseña o solo celular), favoritos (server-side, migración 006), cuenta de la clienta, Telegram para confirmaciones. Header: Catálogo · New In · Entrega inmediata (+ Mi cuenta / Favoritos / Dudas).

**Panel admin `/admin` (OWNER)** — completos y desplegados:
- Vender (POS + caja), Balance, Inventario (stock, ajustes), **Productos en 3 listas** (Productos = pedidos online/`ON_DEMAND`; Entrega inmediata; En camino) con **edición en línea** de precio y stock, **costo tienda USD** con comisión (Sin/10 %/15 %) y costo MXN calculado, chip **Visible/Oculto** clicable (no deja publicar a $0), Categorías, Sincronización de catálogo (Maw Maw + Oskin), Clientes, Proveedores, Pedidos, Por ordenar, En camino (tickets de clientas), Agenda, Cobranza, Devoluciones, Cotizaciones (007), **Estadísticas** (ventas por periodo con comparativo, más vendidos, margen, clientas top), Configuración (solo lectura), Ayuda.
- **Compras con shopper — Fase 1 (010)**: `/admin/compras` — shopper = un Proveedor; compra con tipo de cambio y comisión 10/15 %; tickets de tienda con tax por ticket; artículos con foto opcional (subida manual); cuadre contra el total real con tax; al confirmar congela `owed_usd = total_real + comisión`, `owed_mxn`, costo por línea/unidad; abonos al shopper y saldos por compra y por shopper.
- **Compras con shopper — Fase 2 (011, PR #44)**: asignar unidades de un artículo `PURCHASED` a una clienta con el precio de venta que ella fije → crea orden `ADMIN_MANUAL` + partida (sin producto) + ticket `ORDERED`, pago completo, `ON_DEMAND`, **sin tocar inventario**. Costo congelado por asignación: `max(0, F(A+k) − S)` con `F(n)=floor(C·n/Q)` (la línea suma exactamente su costo). Cancelar solo si el ticket sigue `ORDERED` y la clienta no ha pagado. `/admin/compras/pendientes` lista comprado/asignado/disponible (vista `purchase_item_availability`). En `/admin/pedidos/[id]` estos pedidos ocultan "Cancelar pedido" (usar "Cancelar asignación").
- **Compras con shopper — Fase 3 (014, PR #47)**: embarques `EMB-AAAA-NNNN` (paquetería, guía, costo de envío, llegada estimada). Una línea de embarque = **una asignación completa** (con su ticket) o **unidades libres** de un artículo; nada viaja en dos embarques activos. Envío prorrateado **por piezas** (residuo al mayor residuo). Confirmar salida → tickets `ORDERED→IN_TRANSIT` + aviso a la clienta (campanita y Telegram). **Recepción** (`receive_shipment`) con buenas/dañadas/faltantes, fotos y observaciones, en varias sesiones: asignación con todo bueno → `READY_FOR_DELIVERY`; con daño/falta → `RECEIVED_LA_PAZ` + `tickets.incident_reason`; unidades libres buenas → producto `IMMEDIATE` oculto a $0 + movimiento `RECEIPT`. Cuenta de paquetería (por salida, mes y paquetería; pagado/por pagar). **No se amplió el CHECK de `purchase_items.status`**: dónde está cada pieza se calcula con la vista `purchase_item_shipping`. Las unidades libres que van en un embarque ya no se pueden asignar a clientas.
- **Estadísticas** (PR #48): los tickets sin variante (compras con shopper) usan como costo `purchase_assignments.cost_mxn_cents` + su envío prorrateado.
- **Panel de empleado `/empleado` — Etapa 1 (012/013, PR #45)**: roles OWNER/EMPLOYEE (`getAdminSession`/`requireAdminActor` solo OWNER; `requireStaffActor` para ambos; el empleado nunca entra a `/admin`, auditadas las 62 acciones, el CSV de productos y el layout), alta/baja de empleados en `/admin/empleados` (la dueña teclea la contraseña inicial), Inventario en La Paz (alta de producto oculto sin costo, entradas con foto y quién), Entregas programadas y **Confirmar entrega** de 4 pasos (efectivo = pago confirmado a nombre del empleado/"Mi caja de hoy"; transferencia = comprobante **reportado**, la dueña lo aprueba en Cobranza; recibe la clienta u otra persona con nombre y relación; entrega por ticket completo; saldo pendiente exige confirmación). Lecturas del empleado por lista blanca `STAFF_SELECTS` (nunca costos/comisiones).
- **Placeholders honestos ("Próximamente")** que siguen: Reportes, Facturación (+ global, reportería), Sitio Web. Multi-negocio: la BD guarda `business_id` pero el selector solo muestra un aviso.

### Fusionado recientemente (no dupliques)
- PR #43 (IA externa): página pública `/productos-en-camino` (`getIncomingProducts` en `lib/supabase/catalog.ts`): productos `IMMEDIATE` + `in_transit` + visibles. Botón añadido al header.
- PR #44 (Fase 2), #45 (panel de empleado, Etapa 1), #47 (Fase 3), #48 (margen en Estadísticas), #46 (docs).
- No hay agentes trabajando en este momento.

### Por construir (en orden sugerido)
1. **Compras con shopper — Fase 4: "Próximamente" público con apartados.** Publicar unidades **libres** (no asignadas) con foto, precio de venta y llegada estimada; cada apartado reduce lo disponible. **Antes de construir hay que aclarar con la dueña** (ver §12): cómo aparta una clienta (¿desde la web con cuenta, o lo registra ella/el empleado?), si pide anticipo, si el apartado vence, y qué pasa con unidades en embarque. Reutilizar: `purchase_items.product_id/variant_id`, `products.in_transit`, la vitrina `/productos-en-camino` (PR #43) y el patrón de función SQL atómica con `FOR UPDATE` de `assign_purchase_item`.
2. **Panel de empleado — Etapa 2: "En camino / recepción"** (`/empleado/recepcion` hoy es una página "Próximamente"). Los ganchos ya existen (ver §12).
3. **Sitio Web** (placeholder `app/admin/sitio-web/page.tsx`): editar textos/portada/banners del sitio público, ordenar secciones del catálogo, dominio y metadatos SEO. Independiente de compras/empleados: **buen candidato para otra IA**.
4. **Resolución de incidencias de recepción** (unidad dañada/faltante en un ticket de clienta: reponer, ajustar o reembolsar). Hoy solo se registra y se avisa (`tickets.incident_reason`, aviso en En camino y Embarques).
5. **Reversión de una entrega confirmada** (solo dueña) y **cierre formal de caja** del empleado. Además: los atajos de la dueña ("Completar" en Agenda, avanzar a Entregado desde Pedidos) **no exigen** los datos del flujo de 4 pasos; decidir si el flujo del empleado debe ser el único camino.
6. **Fotos > 1 MB en el formulario de Productos** (el servidor rechaza cuerpos > 1 MB; el formulario dice 5 MB): comprimir en cliente (`app/admin/compras/compress-photo.ts`) o subir el límite.
7. **Regla de pedidos online** (§9, punto 1): decidir si `ON_DEMAND` debe saltarse la validación de existencia al confirmar un pedido.

## 7. Decisiones de alcance de la dueña (no las reabras sin que ella lo pida)

- Congelados a propósito: **Reportes, Facturación (3 pantallas), Multi-negocio** (Facturación además requiere PAC del SAT). **Empleados ya NO está congelado.**
- "Productos entrega inmediata" = solo lo que **ella sube a mano**; la sincronización crea siempre `ON_DEMAND`. "En camino" = mercancía **propia** ya comprada (`IMMEDIATE` + `in_transit`), distinta de los pedidos de clientas (`/admin/en-camino`).
- Tipo de cambio USD→MXN: **sin valor por defecto**; ella lo captura en la barra sobre la tabla de Productos (**pendiente: aún no lo captura**). Tax US = factor 1.083 (editable); comisión 10 % o 15 % **sobre el total ya con tax**.
- El shopper **adelanta** las tiendas: ella le paga total con tax + comisión, menos abonos.
- Entrega: los datos se registran **antes** de marcar "Entregado"; no hay entregas anticipadas.

## 8. Acciones pendientes de la dueña

1. ✅ Migraciones 010–014 aplicadas (2026-10-04). **Falta**: crear su primer empleado en `/admin/empleados`, y hacer una **prueba de punta a punta con datos reales y poco dinero** (compra de prueba → confirmar → asignar a una clienta → embarque → recepción → agendar → entrega con cobro). Se recomienda anotar y borrar/ignorar los datos de prueba (los contadores de folio avanzarán).
2. Capturar el **tipo de cambio** (barra sobre Productos) para activar el costo en dólares.
3. Ponerle **precio** (inline) a los 402 productos Bath & Body Works y publicarlos con el chip Oculto→Visible. El CSV de referencia en USD (`precios-usd-bath-and-body-works.csv`) se le entregó por chat.
4. Confirmar **Phone** en Supabase Auth (login solo con celular).
5. Revisar la regla de pedidos online (ver §9, punto 1).
6. (Opcional) Sincronización cada 15 min vía programador externo (cron-job.org/GitHub Actions) a `POST /api/sync/run?type=INCREMENTAL&source=mawmaw` y `…source=oskin` con header `x-sync-secret`; hoy corre 1 vez al día.

## 9. Riesgos / deuda conocida

1. **`confirmOrderAction` (`app/admin/pedidos/actions.ts`) exige existencia (`variant_stock`) también para productos `ON_DEMAND`**, y todos están en stock 0 → hoy **no se puede confirmar un pedido online**. Decidir con la dueña si "por pedido" debe saltarse esa validación. (Las asignaciones de compras con shopper no pasan por ahí.)
2. La sincronización **solo sube precios** (nunca baja): si ella baja un precio de un producto sincronizado, el próximo sync lo vuelve a subir.
3. Flujos operativos **nunca ejercitados con datos reales** (producción tiene 0 pedidos/ventas/tickets reales): venta POS de punta a punta, Cobranza, Agenda, Devoluciones (cifrado de CLABE sin probar con PostgREST `bytea`), plan semanal. Probar con la dueña antes de operar de verdad.
4. Fotos y datos de Bath & Body Works/Maw Maw/Oskin vienen de esos sitios: confirmar derecho de uso.
5. Los contadores de folio (`sale_number_seq`, `ticket_number_seq`) se reiniciaron a 1 tras las pruebas; pruebas posteriores de agentes pueden avanzarlos de nuevo (cosmético).
6. El total de productos crece solo (sync diario); no asumas conteos fijos.

## 10. Cómo repartir trabajo a otra IA (p. ej. ChatGPT/Codex)

- Que lea este archivo y el código; que trabaje en **su propia rama y worktree**, con PR propio y el flujo de git del §1.
- Asignación sugerida: **Sitio Web** (sin dependencias con compras/empleados). Rango de migraciones libre: **014+** (coordínalo antes de crear una).
- No debe tocar: `getAdminSession`/`requireAdminActor` (blindaje de roles en curso), `app/admin/compras/*`, `lib/supabase/admin-purchases.ts`, `app/empleado/*`.
- Debe respetar las reglas de oro (§1), el sistema de diseño (variables `--admin-*`/`--terracotta*`; botones de texto 39 px / radius 12 px; íconos 36×36 / radius 10 px) y verificar con datos reales o PGlite.

## 11. Mapa rápido de rutas admin

`/admin` (resumen) · `/admin/vender` · `/admin/balance` · `/admin/inventario` (+ `/sincronizacion`) · `/admin/productos` (online) · `/admin/productos/entrega-inmediata` · `/admin/productos/en-camino` · `/admin/productos/nuevo` · `/admin/categorias` · `/admin/clientes` · `/admin/proveedores` · `/admin/pedidos` (+ `/nuevo`, `/[id]`) · `/admin/por-ordenar` · `/admin/en-camino` · `/admin/agenda` · `/admin/cobranza` · `/admin/devoluciones` · `/admin/cotizaciones` · `/admin/estadisticas` · `/admin/compras` (+ `/nueva`, `/[id]`; `/pendientes` en la Fase 2) · `/admin/empleados` (alta de empleados, en el PR del panel de empleado) · `/admin/configuracion` · `/admin/ayuda` · placeholders: `/admin/reportes`, `/admin/facturacion*`, `/admin/sitio-web`.


## 12. Detalles técnicos para quien siga (Fase 4 y Etapa 2 del empleado)

**Etapa 2 del panel de empleado — recepción.** Función TS: `receiveShipment({ actorId, shipmentId, lines: [{ lineId, good, damaged, missing, notes, photoKeys }] })` en `lib/supabase/admin-shipments.ts`; detrás llama a la función SQL `receive_shipment(p_shipment_id, p_actor_id, p_lines jsonb)`. Solo exige que el actor sea una fila ACTIVE de `admin_users` (no revisa OWNER): desde `/empleado` basta `requireStaffActor()` y pasar su id. Fotos: antes `uploadShipmentPhoto(shipmentId, file)` (bucket privado `expense-receipts`; JPEG comprimido en cliente con `compress-photo.ts`; **una foto por envío** por el límite de 1 MB) y `removeShipmentPhotos(keys)` si la recepción falla. `getShipmentDetail(id)` y `listShipments()` **devuelven costos**: el empleado NO debe verlos → usar una lectura reducida (patrón `STAFF_SELECTS` en `lib/supabase/staff-*.ts`). `receiveLineAction` exige OWNER → crear una acción propia del empleado. Modelo de UI: `ReceiveLineDialog` en `app/admin/compras/embarques/ShipmentForms.tsx`. Shell/menú del empleado: `app/empleado/*`, `components/navigation/StaffNav.tsx`. Avisos de migración faltante: copiar el patrón de `lib/supabase/staff-schema.ts`.

**Fase 4 — "Próximamente".** Estado de datos hoy: unidades libres de un artículo = comprado − asignado ACTIVE (vista `purchase_item_availability`); si van en un embarque activo ya **no** se pueden asignar (vista `purchase_item_shipping`). `purchase_items.product_id/variant_id` existen y se llenan cuando llegan unidades libres buenas (producto `IMMEDIATE` oculto a $0). Para publicar "próximamente" hará falta decidir el modelo de apartado (¿nueva tabla `purchase_reservations` ligada a `purchase_items` con cantidad, clienta, estado y vencimiento?, ¿un apartado es una asignación con precio fijado por la dueña y pago posterior?). Requisito de la dueña: "cada apartado reduce la cantidad disponible" → implementarlo como función SQL atómica con `FOR UPDATE` sobre la línea, igual que `assign_purchase_item`, para que no se pueda apartar de más. La vitrina pública puede partir de `/productos-en-camino` (`getIncomingProducts`). Respeta la regla de que un producto no se publica a $0.

**Para quien trabaje en paralelo:** los worktrees de agentes pueden quedar en `.claude/worktrees/` (ignorar/limpiar con `git worktree remove` cuando no haya agentes); `npm run lint` puede marcar archivos ahí: excluirlos. `npm test` sigue roto de antes (no bloquea el deploy). Hay 13 avisos de `<img>` preexistentes.