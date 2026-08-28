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

for (const pathname of ["/cuenta", "/admin"]) {
  test(`protects ${pathname}`, async () => {
    const response = await fetch(`${origin}${pathname}`, { redirect: "manual" });
    assert.equal(response.status, 307);
    assert.match(response.headers.get("location") ?? "", /^\/login\?next=/);
  });
}
