# Ventas — implementación y validación

`/admin/vender` reúne ventas de mostrador y pedidos, con filtros, contadores, búsqueda, orden por fecha, páginas de 20 registros, productos desplegables y exportación de la página o selección. El punto de venta completo se conserva en `/admin/vender/nueva`; los atajos de caja y gasto abren sus diálogos existentes.

El detalle usa identificadores `s-<uuid>` y `p-<uuid>`. Conserva las acciones de confirmación y cancelación existentes y las restricciones de compras con shopper y apartados. Las rutas anteriores de Pedidos siguen disponibles. Incluye productos, pago, notas internas, datos actuales de la clienta, historial registrado e impresión. No inventa gastos de envío, direcciones de facturación ni reembolsos de mostrador que la base no registra.

El seguimiento público usa una consulta independiente con campos permitidos: nombre de pila, productos, cantidades, fotos, estados y fechas. No consulta costos, pagos, direcciones, correo, teléfono ni notas internas. Los tokens tienen 256 bits, pueden revocarse o regenerarse y se vuelven a verificar al terminar la lectura. La ruta es dinámica, no se almacena en caché, no se indexa y no envía el enlace en el encabezado de referencia.

La migración 017 del borrador se mantiene sin cambios. La dueña informó que la aplicó. Las lecturas locales de Supabase devolvieron HTTP 401; no se modificaron datos de producción. Si la vista falta, la lista usa las 1,000 ventas y 1,000 pedidos más recientes y muestra un aviso. La ausencia de la tabla de tokens desactiva únicamente la tarjeta de seguimiento.

## Comprobaciones reproducibles

- `npm run typecheck`, `npm run lint`, `npm run build`.
- `node tests/sales-data.integration.mjs`: lectores y acciones reales con un adaptador en memoria; respaldo, compras sin producto, plan semanal, privacidad, revocación durante la lectura, permisos de administradora, notas auditadas, rotación de tokens, lotes de 150 IDs y más de 1,000 partidas. No contacta Supabase.
- `npm install --prefix .tmp/pglite --no-package-lock @electric-sql/pglite` y `node tests/sales-feed.pglite.mjs`: migración idempotente, igualdad SQL/TypeScript, filtros, orden mezclado, paginación, cliente ausente, productos de shopper, cancelaciones/reembolsos, precisión de centavos, restricciones y permisos de tokens. PGlite se instala solo en el scratchpad; no cambia `package.json`.
- Capturas de los componentes reales con datos ficticios a 1440 y 375 px: lista poblada, estado vacío, detalle y seguimiento. Se comprobaron expansión de productos, ausencia de desbordamiento y reglas de impresión. Los harness HTML temporales se borraron antes del commit. Las capturas locales se conservan en `outputs/ventas/`, fuera de Git.

Las pruebas con sesión administrativa y escrituras en Supabase real no se realizaron: no se introducen contraseñas ni se crean ventas de prueba en producción. Los avisos de `<img>` del lint no son errores de compilación.

## Ubicación de productos y pickup

El detalle de Ventas permite actualizar cada ticket desde el diálogo existente. Las cuatro ubicaciones usan los estados existentes, sin migración: `ORDERED` = En bodega de McAllen, `IN_TRANSIT` = En paquetería, `RECEIVED_LA_PAZ` = En sucursal de La Paz, `READY_FOR_DELIVERY` = Listo para entrega en La Paz. Los estados finales y las entregas ya agendadas no muestran este control; la agenda continúa siendo el lugar donde se reserva el horario.

El seguimiento conserva la ubicación exacta por producto y muestra “Favor de agendar pickup” solo para productos listos, sin invitación para cancelaciones ni entregas ya agendadas. El enlace lleva a `/contacto`, los canales actuales del sitio; no registra por sí mismo una cita ni comparte el token con servicios externos. Se probó cada ubicación, la ocultación del aviso al agendar/cancelar y el diseño a 1440/375 px.

El mismo aviso aparece en el panel privado de la clienta (`/cuenta`), junto a cada producto listo. Ambos lugares usan el componente `PickupNotice`. El panel muestra todos los productos activos que ya devuelve su lectura bajo la sesión de la clienta, sin limitarse a los primeros cuatro; no se cambia el acceso ni la lectura de sus datos. Una prueba de renderizado comprueba los cuatro estados, el producto listo después del cuarto, el aviso único y su ausencia en entregas agendadas o canceladas. El panel se revisó a 1440 y 375 px con datos ficticios.

## Semáforo por producto

El detalle muestra botones con colores para McAllen, paquetería, sucursal La Paz y listo para entrega. En ventas de mostrador incluye Entregado. Los pedidos reutilizan su acción logística y mantienen la agenda para entregar. Los cambios actualizan seguimiento público y compras activas del cliente autenticado; las ventas sin cliente solo tienen seguimiento por enlace.

La dueña debe aplicar manualmente `database/migrations/018_sale_item_fulfillment.sql` después de 017. Esta tabla guarda ubicaciones por artículo sin modificar pagos ni inventario; las ventas antiguas conservan Entregado por defecto. Antes de aplicar 018 los botones de mostrador muestran el aviso y están desactivados. SQL probado dos veces en PGlite, incluyendo permisos, estados, cancelaciones y equivalencia de la vista. Acciones probadas con autorización, pertenencia del artículo, falta de migración y sincronización pública; panel probado para impedir productos de otro cliente. QA visual escritorio/móvil con fixtures.

Los clics reales del componente se probaron en Chromium con acciones simuladas: artículo correcto, selección tras guardar, actualización de página, fallo sin cambiar el estado y aviso de pickup solo al estar listo.
