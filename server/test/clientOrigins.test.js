const assert = require("node:assert/strict");
const { test } = require("node:test");
const { getClientOrigins } = require("../src/config/clientOrigins");

test("client origin allowlist accepts multiple configured frontend origins", () => {
  assert.deepEqual(
    getClientOrigins(
      "https://mergemind.example, https://preview.example, ,http://localhost:5173"
    ),
    [
      "https://mergemind.example",
      "https://preview.example",
      "http://localhost:5173",
    ]
  );
});

test("client origin allowlist defaults to the local Vite origin", () => {
  assert.deepEqual(getClientOrigins(""), ["http://localhost:5173"]);
});
