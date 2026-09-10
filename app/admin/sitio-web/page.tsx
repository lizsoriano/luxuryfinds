import { ComingSoon } from "../../../components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      eyebrow="GESTIONA TU NEGOCIO"
      title="Sitio Web"
      phase="Fase 4"
      summary="El sitio público de Luxury Finds ya existe y funciona (catálogo, entrega inmediata, por pedido, cuenta de clienta). Lo que no existe todavía es poder editarlo desde el panel."
      bullets={[
        "Editar textos, portada y banners del sitio.",
        "Ordenar las secciones del catálogo virtual.",
        "Dominio propio y metadatos para buscadores.",
      ]}
      availableNow={[
          { label: "Ver el sitio público", href: "/", description: "El sitio ya está en línea con el catálogo actual." },
          { label: "Productos", href: "/admin/productos", description: "Marca un producto como visible para publicarlo en el catálogo." },
      ]}
    />
  );
}
