import assert from "node:assert/strict";
import { test } from "node:test";
import { findBrand, names } from "./match";

const kinds = (text: string, brand: string, variants?: string[]) =>
  findBrand(text, brand, variants).map((m) => `${m.kind}:${m.text}`);

test("exact and other spellings, case-insensitive", () => {
  assert.deepEqual(kinds("Try K18 first.", "K18"), ["exact:K18"]);
  assert.deepEqual(kinds("try k18, K-18 or K 18 Hair", "K18"), ["spelling:k18", "spelling:K-18", "spelling:K 18"]);
  assert.deepEqual(kinds("K18's mask and K18™ serum", "K18"), ["exact:K18", "exact:K18"]);
});

test("whole words only", () => {
  assert.deepEqual(kinds("The K180, AK18, K19 and k18hair.com are different.", "K18"), []);
});

test("variants, reporting which one matched", () => {
  const [m] = findBrand("The FutureIQ serum", "k18", ["k18", "FutureIQ", "k-eighteen"]);
  assert.equal(m.variant, "FutureIQ");
  assert.deepEqual(kinds("K eighteen works", "k18", ["k-eighteen"]), ["spelling:K eighteen"]);
  assert.deepEqual(names("k18", ["K18", "k-eighteen"]), ["k18", "k-eighteen"]);
});

test("fuzzy only for longer names", () => {
  assert.deepEqual(kinds("Olaplx No. 3", "Olaplex"), ["fuzzy:Olaplx"]);
  assert.deepEqual(kinds("K19 and K1B", "K18"), []);
});

test("line position, character position and sentence", () => {
  const text = "Here are my picks:\n\n1. Olaplex No. 3 - a classic.\n2. K18 Leave-In Mask. It repairs bonds fast! Pricey.\n";
  const [m] = findBrand(text, "K18");
  assert.equal(m.line, 3);
  assert.equal(m.lines, 3);
  assert.equal(m.offset, text.indexOf("K18"));
  assert.equal(m.sentence, "K18 Leave-In Mask.");
  const [n] = findBrand("Most people like it. The best is K18 for damage. Others disagree.", "K18");
  assert.equal(n.sentence, "The best is K18 for damage.");
});
