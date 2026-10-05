# Cambios del 2026-10-04

## Implementado

- **Sitio Web** (`/admin/sitio-web`): edición de textos, portada por URL o subida comprimida, aviso, orden de secciones de inicio y pestañas del catálogo, título y descripción SEO y dominio principal. Se guarda solo la clave nueva `public_site_content` de `app_settings`; los valores existentes no se alteran. Sin configuración, la portada mantiene sus valores anteriores. El dominio configura metadatos: conectar un dominio diferente también requiere Vercel/DNS.
- **Recepción para empleados**: lista paginada de embarques en camino y recepción por línea (buenas, dañadas, faltantes, observaciones y una foto comprimida). Acciones protegidas con `requireStaffActor`; lecturas reducidas sin costos ni comisiones. Usa `receive_shipment` de 014 y registra al empleado como actor.
- **Fotos de Productos**: se comprime el conjunto de hasta tres imágenes, con presupuesto total de 800 KB. También se comprueba el tamaño del formulario completo antes de enviarlo. Mantiene el límite de origen de 5 MB por foto.

## Activación manual

Ejecutar `database/migrations/015_staff_reception.sql` en el editor SQL de Supabase, después de 014. El agente no la ejecutó en producción. Antes de aplicarla, el detalle de recepción muestra el archivo pendiente; los demás módulos siguen funcionando.

## Validación

- `npm run typecheck`, `npm run lint` (0 errores, 13 avisos previos), `npm run build`.
- Lecturas GET de Supabase: columnas de `shipments` y `app_settings` válidas; vista 015 ausente con 404/PGRST205.
- 015 en PGlite temporal: idempotencia, cantidades, ausencia de costos, denegación de SELECT a anon/authenticated y concesión a service_role.
- Contenido: rutas permitidas, rechazo de javascript/URLs con credenciales, configuración por defecto y reordenación de catálogo.
- Navegador con harness temporal: tres fotos originales de 3,441,418 bytes; formulario completo comprimido de 544,986 bytes. Harness retirado.
- No se modificaron registros reales, no se introdujeron contraseñas y no se ejecutó DDL en Supabase.

## Cuarto pendiente: Próximamente con apartados

Reglas confirmadas por la dueña: anticipo de 50 %, con monto alternativo editable por ella; plazo de un mes; se permite apartar unidades libres que ya van en un embarque.

Faltan dos respuestas antes de implementar el flujo: quién registra el apartado (clienta en web o dueña/empleado) y qué hacer al vencer el mes (avisar para decisión manual o liberar automáticamente). No se asume la disposición del anticipo.

Siguiente número de migración libre: 016. La rama y carpeta originales de la dueña conservan sus cambios locales.
