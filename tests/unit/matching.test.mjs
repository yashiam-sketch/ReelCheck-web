import assert from "node:assert/strict";
import test from "node:test";
import { isSameTitle, levenshtein, normalize, similarity } from "../../js/matching.js";

test("normalize folds case, accents, punctuation and a leading article", () => {
  assert.equal(normalize("The Lord of the Rings: The Return of the King"), "lord of the rings the return of the king");
  assert.equal(normalize("Amélie"), "amelie");
  assert.equal(normalize("Schindler's List"), "schindlers list");
  assert.equal(normalize("Fast & Furious"), "fast and furious");
  assert.equal(normalize("The"), "the");
  assert.equal(normalize("The Batman", { keepLeadingArticle: true }), "the batman");
});

test("levenshtein", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("same", "same"), 0);
});

test("similarity", () => {
  assert.equal(similarity("Inception", "INCEPTION"), 1);
  assert.equal(similarity("The Matrix", "Matrix"), 1);
  assert.ok(similarity("Incepti0n", "Inception") > 0.85);
  assert.ok(similarity("Dune: Part Two", "Dune Part Two") === 1);
  assert.ok(similarity("Barbie", "Oppenheimer") < 0.3);
  assert.equal(similarity("", "x"), 0);
});

test("isSameTitle never equates different sequel numbers", () => {
  assert.equal(isSameTitle("Toy Story 3", "Toy Story 4"), false);
  assert.equal(isSameTitle("Rocky IV", "Rocky V"), false);
  assert.equal(isSameTitle("Toy Story 3", "toy story 3"), true);
  assert.equal(isSameTitle("Inception", "Incepti0n"), true);
});
