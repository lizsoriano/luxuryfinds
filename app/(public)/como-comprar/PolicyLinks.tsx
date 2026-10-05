"use client";

export function PolicyLinks({ policies }: { policies: Array<{ id: string; title: string }> }) {
  return <nav aria-label="Políticas de Luxury Finds">{policies.map(item => <a href={`#${item.id}`} key={item.id} onClick={() => {
    const section = document.getElementById(item.id);
    if (section instanceof HTMLDetailsElement) section.open = true;
  }}>{item.title}<span aria-hidden="true">↗</span></a>)}</nav>;
}
