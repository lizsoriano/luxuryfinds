import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const port = 3219;
const origin = `http://127.0.0.1:${port}`;
let server;

before(async () => {
  server = spawn(process.execPath, [".output/server/index.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Nitro production server did not start");
});

after(() => server?.kill());

test("serves banner sharing metadata in the initial head for WhatsApp", async () => {
  for (const pathname of ["/entrega-inmediata", "/productos-en-camino"]) {
    const response = await fetch(`${origin}${pathname}`, { headers: { "User-Agent": "WhatsApp/2.25" } });
    const html = await response.text();
    const head = html.slice(0, html.indexOf("</head>"));
    assert.match(head, /property="og:image" content="https:\/\/www\.luxuryfinds\.com\.mx\/og-banner\.jpg"/);
    assert.match(head, /property="og:image:type" content="image\/jpeg"/);
    assert.match(head, /property="og:title"/);
  }
  const image = await fetch(`${origin}/og-banner.jpg`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type") ?? "", /^image\/jpeg/);
});

test("renders Luxury Finds FAQs and policy links", async () => {
  const response = await fetch(`${origin}/como-comprar`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Preguntas frecuentes/);
  assert.match(html, /20 a 30 días hábiles/);
  assert.match(html, /anticipo del 50%/);
  assert.match(html, /href="#entregas"/);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /Oskin|Kueski|Paypal|help@oskin/);
});

test("redirects duplicate coming-soon section to incoming products", async () => {
  const response = await fetch(`${origin}/proximamente`, { redirect: "manual" });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "/productos-en-camino");
  const home = await fetch(origin);
  const html = await home.text();
  assert.match(html, /href="\/productos-en-camino"/);
  assert.doesNotMatch(html, /href="\/proximamente"/);
});

test("serves stable panel styles", async () => {
  const login = await fetch(`${origin}/login`);
  assert.match(await login.text(), /href="\/styles\/luxury-finds\.css"/);
  const response = await fetch(`${origin}/styles/luxury-finds.css`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/css\b/i);
  const css = await response.text();
  assert.match(css, /\.staff-topbar\s*\{/);
  assert.match(css, /\.staff-photo-drop\s*\{/);
});

for (const [pathname, expected] of [
  ["/", "Encuentra algo"],
  ["/catalogo", "Encuentra tu próximo"],
  ["/por-pedido", "Compras"],
  ["/entrega-inmediata", "Entrega"],
  ["/login", "Inicia sesión"],
]) {
  test(`renders ${pathname}`, async () => {
    const response = await fetch(`${origin}${pathname}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.match(await response.text(), new RegExp(expected, "i"));
  });
}

for (const pathname of ["/cuenta", "/admin", "/empleado", "/empleado/recepcion"]) {
  test(`protects ${pathname}`, async () => {
    const response = await fetch(`${origin}${pathname}`, { redirect: "manual" });
    assert.equal(response.status, 307);
    assert.match(response.headers.get("location") ?? "", /^\/login\?next=/);
  });
}
