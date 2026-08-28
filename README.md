# Luxury Finds

Aplicación de catálogo, portal de clientes y administración construida con Vinext, Vite, React y Nitro. El despliegue de producción usa Vercel; los datos, autenticación y archivos usan Supabase.

## Requisitos

- Node.js 24.x
- Un proyecto Supabase con `database/schema.sql` instalado

## Variables de entorno

Copia `.env.example` como `.env.local` y completa:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
```

La clave `SUPABASE_SECRET_KEY` es exclusiva del servidor. Nunca debe incluirse en una variable pública ni utilizarse desde componentes cliente.

## Desarrollo

```bash
npm install
npm run dev
```

## Validación

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

El build Nitro local se genera en `.output`. En Vercel, Nitro detecta el entorno y genera el Build Output API en `.vercel/output`.

## Supabase

- El catálogo consulta explícitamente el esquema `luxury_finds` y obtiene imágenes públicas de `product-images`.
- Supabase Auth mantiene la sesión mediante cookies SSR.
- `/cuenta` usa el UUID autenticado y respeta RLS para consultar datos del cliente.
- `/admin` requiere, además de sesión, un perfil activo en `luxury_finds.admin_users`.
- Los comprobantes se almacenan privadamente en `payment-proofs/<auth-user-id>/...` y su registro se crea desde una acción segura del servidor.

Consulta [database/README.md](database/README.md) para instalar y administrar el esquema.
