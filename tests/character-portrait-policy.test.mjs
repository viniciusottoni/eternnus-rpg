// Imagem do personagem (ADR-097): regras puras.
import test from "node:test";
import assert from "node:assert/strict";
import { portraitUrl, initials, portraitFileError, characterName, PORTRAIT_MAX_BYTES } from "../apps/Eternnus.Web/wwwroot/js/character-portrait-policy.js";

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

test("URL só com GUID válido e versão positiva", () => {
  assert.equal(portraitUrl(id, 3), `/api/characters/${id}/portrait?v=3`);
  assert.equal(portraitUrl(id, 0), null);
  assert.equal(portraitUrl(id, "2"), `/api/characters/${id}/portrait?v=2`);
  assert.equal(portraitUrl("../admin", 1), null);
  assert.equal(portraitUrl(`${id}"><script>`, 1), null);
  assert.equal(portraitUrl(null, 1), null);
  assert.equal(portraitUrl(id, 1.5), null);
});

test("iniciais do nome", () => {
  assert.equal(initials("Lira das Marés"), "LM");
  assert.equal(initials("aurora"), "AU");
  assert.equal(initials("   "), "?");
  assert.equal(initials("Élan"), "ÉL");
});

test("valida tipo e tamanho antes do envio", () => {
  assert.equal(portraitFileError({ type: "image/png", size: 10 }), "");
  assert.equal(portraitFileError({ type: "image/jpeg", size: PORTRAIT_MAX_BYTES }), "");
  assert.match(portraitFileError({ type: "image/webp", size: 10 }), /PNG ou JPEG/);
  assert.match(portraitFileError({ type: "image/png", size: PORTRAIT_MAX_BYTES + 1 }), /20 MB/);
  // Limite do plano informado pelo chamador (ADR-102).
  assert.equal(portraitFileError({ type: "image/png", size: PORTRAIT_MAX_BYTES + 1 }, 60 * 1024 * 1024), "");
  assert.match(portraitFileError({ type: "image/png", size: 61 * 1024 * 1024 }, 60 * 1024 * 1024), /60 MB/);
  assert.match(portraitFileError(null), /Escolha/);
});

test("nome vem do campo com papel name, depois da ficha", () => {
  const sheet = { name: "Antigo", version: { fields: [{ name: "nome", role: "name" }] }, values: { nome: "Lira" } };
  assert.equal(characterName(sheet), "Lira");
  assert.equal(characterName({ ...sheet, values: {} }), "Antigo");
  assert.equal(characterName({}), "Personagem");
});
