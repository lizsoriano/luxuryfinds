# Cambios del 2026-10-04

## Implementado

- **Sitio Web**: edición de textos, portada comprimida, aviso, orden de inicio y catálogo, SEO y dominio principal. Solo guarda la clave `public_site_content`; conectar otro dominio requiere Vercel/DNS.
- **Recepción para empleados**: embarques y recepción por línea, con cantidades, incidencias y foto comprimida. Lecturas sin costos; acciones autenticadas.
- **Fotos de Productos**: hasta tres fotos comprimidas con presupuesto total de 800 KB y comprobación del formulario completo.
- **Próximamente y Apartados**: publicar compras confirmadas con precio, foto y fecha estimada; público ve únicamente unidades libres. Solo OWNER registra apartados, también sobre unidades libres de embarques. Anticipo predeterminado del 50 %, editable, vencimiento de un mes calendario. Ticket y abono se crean juntos; recepción reserva existencias y entrega requiere recepción completa y liquidación. Abonos posteriores desde Apartados o Cobranza.
- **Vencimiento**: el saldo pendiente libera las unidades, cancela el ticket y avisa «Tu producto no ha sido liquidado; pasa a disponible.». Conserva abonos e historial; no decide devolución o pérdida del anticipo. Los apartados liquidados no vencen. Cuenta muestra el apartado y sus avisos.

## Activación manual

Aplicar `015_staff_reception.sql` después de 014 y luego `016_incoming_reservations.sql` en el editor SQL de Supabase. El agente no ejecutó estas migraciones en producción. Aplicar 016 al final: envuelve las funciones de embarques de 014. Ambas son idempotentes. Revisar y respaldar la base antes de aplicar.

Disponibilidad y existencias descuentan/liberan apartados según su vencimiento, incluso antes del proceso programado. Visitar las páginas de apartados, Próximamente o Cuenta materializa vencimientos y avisos internos. El endpoint autorizado `/api/sync/run` procesa vencimientos y la cola Telegram antes de sincronizar; `dryRun=1` no procesa apartados. Usa el cron existente. Telegram se envía en su siguiente ejecución y reintenta fallos; no garantiza aviso al minuto exacto. Para una frecuencia superior, configurar un programador externo autenticado. No requiere nuevas variables de entorno.

## Validación

- TypeScript y lint sin errores; compilación de producción.
- 015 y 016 probadas en PostgreSQL WASM/PGlite temporal con datos ficticios: permisos, idempotencia, 50 % y monto alternativo, reintentos, sobreapartado, recepción parcial, stock, liquidación, vencimiento, pagos preservados y aviso único.
- Regresión reproducible desde la raíz: `npm install --prefix .tmp/pglite --no-save --package-lock=false @electric-sql/pglite`, luego `node tests/incoming-reservations.test.mjs`. Ejecuta exclusivamente una base en memoria.
- Navegador: formulario de tres fotos originales de 3,441,418 bytes cada una comprimido a 544,986 bytes incluyendo multipart.
- No se modificaron registros reales ni se ejecutó DDL en Supabase. La rama original conserva sus cambios locales.
