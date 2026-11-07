import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";
import { bestPlay, chooseWord, decideBid, wordReward } from "./strategy.js";

const rack = (letters: string) => {
  const r = new Map<string, number>();
  for (const c of letters) r.set(c, (r.get(c) ?? 0) + 1);
  return r;
};

const ENABLE = fs
  .readFileSync(new URL("../wordlist.txt", import.meta.url), "utf8")
  .split("\n")
  .map((l) => l.trim().toUpperCase())
  .filter((l) => l.length >= 2);

test("chooseWord picks the longest word the rack can spell", () => {
  const dictionary = ["TACT", "CAT", "AT"];
  assert.equal(chooseWord({ myRack: rack("TACT"), dictionary }), "TACT");
  assert.equal(chooseWord({ myRack: rack("CATX"), dictionary }), "CAT");
  assert.equal(chooseWord({ myRack: rack("CX"), dictionary }), null);
});

test("chooseWord prefers higher reward over a slightly longer cheap word", () => {
  const dictionary = ["AAAA", "QAT"];
  // AAAA = 4 * 1.5 = 6; QAT = 12
  assert.equal(wordReward("AAAA"), 6);
  assert.equal(wordReward("QAT"), 12);
  assert.equal(
    chooseWord({ myRack: rack("QATAAAA"), dictionary, bagTotal: 5 }),
    "QAT",
  );
});

test("chooseWord holds short words while the bag is full", () => {
  const dictionary = ["AT", "CAT"];
  assert.equal(
    chooseWord({
      myRack: rack("AT"),
      dictionary,
      bagTotal: 50,
      myBalance: 80,
    }),
    null,
  );
});

test("bestPlay finds a bingo-style seven", () => {
  const play = bestPlay(rack("RETAINS"), ENABLE, 2);
  assert.ok(play);
  assert.ok(play.word.length >= 7);
  assert.ok(play.reward >= wordReward(play.word));
});

test("decideBid stays within balance", () => {
  const bid = decideBid({
    letter: "E",
    myBalance: 3,
    myRack: rack("R"),
    dictionary: ENABLE,
    auctionType: "Vickrey",
    bagTotal: 40,
  });
  assert.ok(bid >= 0 && bid <= 3);
});

test("decideBid shades first-price below Vickrey", () => {
  const ctx = {
    letter: "S",
    myBalance: 100,
    myRack: rack("CAT"),
    dictionary: ["CATS", "CAT"],
    bagTotal: 40,
  };
  const vickrey = decideBid({ ...ctx, auctionType: "Vickrey" });
  const first = decideBid({ ...ctx, auctionType: "FirstPrice" });
  assert.ok(first <= vickrey);
});

test("chooseWord searches the whole wordlist well within an auction", () => {
  // Warm the index the same way the running bot does at startup.
  chooseWord({ myRack: rack("AT"), dictionary: ENABLE });
  const myRack = rack("BCDFGHJKLMNPQRSTVWXZ");
  const start = performance.now();
  chooseWord({ myRack, dictionary: ENABLE, bagTotal: 40, myBalance: 80 });
  assert.ok(performance.now() - start < 100, "a search took 100 ms or more");
});
