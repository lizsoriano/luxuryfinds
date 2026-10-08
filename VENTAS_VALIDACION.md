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
