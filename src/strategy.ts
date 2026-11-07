// Bidding and word-forming strategy.
//
// Vickrey: bid true estimated value (winner pays runner-up).
// First-price: shade so we don't pay our full valuation.
// Words: maximize integer reward (face values × length multiplier),
// hoarding short racks for the 2.5×/3× bonuses unless cash or bag is tight.

export const LETTER_VALUE: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

const VOWELS = new Set(["A", "E", "I", "O", "U"]);
const PREMIUM = new Set(["J", "Q", "X", "Z"]);

export type AuctionKind = "Vickrey" | "FirstPrice";

export interface BidContext {
  letter: string;
  myBalance: number;
  myRack: Map<string, number>;
  dictionary?: string[];
  auctionType?: AuctionKind;
  bagTotal?: number;
  myScore?: number;
  opponentBestScore?: number;
}

export interface WordContext {
  myRack: Map<string, number>;
  dictionary: string[];
  myBalance?: number;
  bagTotal?: number;
  myScore?: number;
  opponentBestScore?: number;
}

export interface Play {
  word: string;
  reward: number;
}

interface WordEntry {
  word: string;
  length: number;
  mask: number;
  counts: Uint8Array;
  base: number;
  reward: number;
}

interface WordIndex {
  size: number;
  byLength: WordEntry[][];
  maxLen: number;
}

const A = "A".charCodeAt(0);
const SMALL_INDEX = new WeakMap<string[], WordIndex>();
let bigSize = -1;
let bigIndex: WordIndex | null = null;

export function lengthMultiplier(len: number): [number, number] {
  if (len <= 3) return [1, 1];
  if (len === 4) return [3, 2];
  if (len === 5) return [2, 1];
  if (len === 6) return [5, 2];
  return [3, 1];
}

export function wordReward(word: string): number {
  let base = 0;
  for (const c of word) base += LETTER_VALUE[c] ?? 0;
  const [num, den] = lengthMultiplier(word.length);
  return Math.floor((base * num) / den);
}

function rackTiles(rack: Map<string, number>): number {
  let n = 0;
  for (const c of rack.values()) n += c;
  return n;
}

function rackVowels(rack: Map<string, number>): number {
  let n = 0;
  for (const [c, count] of rack) if (VOWELS.has(c)) n += count;
  return n;
}

function letterMask(letter: string): number {
  const i = letter.charCodeAt(0) - A;
  if (i < 0 || i > 25) return 0;
  return 1 << i;
}

function rackMaskAndCounts(rack: Map<string, number>): {
  mask: number;
  counts: Uint8Array;
  tiles: number;
} {
  const counts = new Uint8Array(26);
  let mask = 0;
  let tiles = 0;
  for (const [c, n] of rack) {
    const i = c.charCodeAt(0) - A;
    if (i < 0 || i > 25 || n <= 0) continue;
    counts[i] = Math.min(255, counts[i] + n);
    mask |= 1 << i;
    tiles += n;
  }
  return { mask, counts, tiles };
}

function canSpell(entry: WordEntry, counts: Uint8Array): boolean {
  for (let i = 0; i < 26; i++) {
    if (entry.counts[i] > counts[i]) return false;
  }
  return true;
}

function buildIndex(dictionary: string[]): WordIndex {
  const byLength: WordEntry[][] = [];
  let maxLen = 0;
  for (const raw of dictionary) {
    const word = raw.toUpperCase();
    if (word.length < 2) continue;
    const counts = new Uint8Array(26);
    let mask = 0;
    let base = 0;
    let ok = true;
    for (const ch of word) {
      const i = ch.charCodeAt(0) - A;
      if (i < 0 || i > 25) {
        ok = false;
        break;
      }
      counts[i]++;
      mask |= 1 << i;
      base += LETTER_VALUE[ch] ?? 0;
    }
    if (!ok) continue;
    const [num, den] = lengthMultiplier(word.length);
    const entry: WordEntry = {
      word,
      length: word.length,
      mask,
      counts,
      base,
      reward: Math.floor((base * num) / den),
    };
    (byLength[word.length] ??= []).push(entry);
    if (word.length > maxLen) maxLen = word.length;
  }
  return { size: dictionary.length, byLength, maxLen };
}

function getIndex(dictionary: string[]): WordIndex {
  if (dictionary.length < 10_000) {
    const hit = SMALL_INDEX.get(dictionary);
    if (hit) return hit;
    const built = buildIndex(dictionary);
    SMALL_INDEX.set(dictionary, built);
    return built;
  }
  // Full ENABLE-sized lists share an index regardless of sort order.
  if (bigIndex && bigSize === dictionary.length) return bigIndex;
  bigIndex = buildIndex(dictionary);
  bigSize = dictionary.length;
  return bigIndex;
}

export function prepareDictionary(dictionary: string[]): void {
  getIndex(dictionary);
}

function withLetter(rack: Map<string, number>, letter: string): Map<string, number> {
  const next = new Map(rack);
  next.set(letter, (next.get(letter) ?? 0) + 1);
  return next;
}

/**
 * Highest-reward playable word of at least `minLen`.
 * Tie-break: longer word (clears more tiles).
 */
export function bestPlay(
  rack: Map<string, number>,
  dictionary: string[],
  minLen = 2,
): Play | null {
  const { mask, counts, tiles } = rackMaskAndCounts(rack);
  if (tiles < minLen) return null;
  const index = getIndex(dictionary);
  const maxLen = Math.min(tiles, index.maxLen);
  let best: Play | null = null;
  const topValues: number[] = [];
  for (const [c, n] of rack) {
    const v = LETTER_VALUE[c] ?? 0;
    for (let i = 0; i < n; i++) topValues.push(v);
  }
  topValues.sort((a, b) => b - a);

  for (let len = maxLen; len >= minLen; len--) {
    const bucket = index.byLength[len];
    if (!bucket) continue;
    let cap = 0;
    for (let i = 0; i < len; i++) cap += topValues[i] ?? 0;
    const [num, den] = lengthMultiplier(len);
    const upper = Math.floor((cap * num) / den);
    if (best && (upper < best.reward || (upper === best.reward && len <= best.word.length))) {
      continue;
    }
    for (const entry of bucket) {
      if ((entry.mask & ~mask) !== 0) continue;
      if (!canSpell(entry, counts)) continue;
      if (
        !best ||
        entry.reward > best.reward ||
        (entry.reward === best.reward && entry.length > best.word.length)
      ) {
        best = { word: entry.word, reward: entry.reward };
      }
    }
  }
  return best;
}

function minPlayLength(
  tiles: number,
  bagTotal: number | undefined,
  balance: number | undefined,
  trailing: boolean,
): number {
  // No bag info (unit tests / first tick): play the best word immediately.
  if (bagTotal === undefined) return 2;
  if (trailing) return 2;
  if ((balance ?? 100) < 12) return 2;
  if (tiles >= 10) return 2;
  if (bagTotal <= 6) return 2;
  if (bagTotal <= 14) return 3;
  if (tiles >= 8) return 4;
  return 5;
}

export function decideBid(ctx: BidContext): number {
  const letter = ctx.letter.toUpperCase();
  const face = LETTER_VALUE[letter] ?? 1;
  const have = ctx.myRack.get(letter) ?? 0;
  const tiles = rackTiles(ctx.myRack);
  const vowels = rackVowels(ctx.myRack);
  const bag = ctx.bagTotal ?? 40;
  const behind =
    ctx.opponentBestScore !== undefined &&
    ctx.myScore !== undefined &&
    ctx.myScore + 8 < ctx.opponentBestScore;

  let value = face;

  if (ctx.dictionary && ctx.dictionary.length > 0) {
    const now = bestPlay(ctx.myRack, ctx.dictionary, 2);
    const next = bestPlay(withLetter(ctx.myRack, letter), ctx.dictionary, 2);
    const delta = (next?.reward ?? 0) - (now?.reward ?? 0);
    value = Math.max(value, delta);

    const expectedMult = tiles >= 6 ? 2.4 : tiles >= 4 ? 1.8 : 1.4;
    const option = Math.round(face * expectedMult * 0.55);
    if (delta < option) value = Math.max(value, option);
  } else {
    value = have === 0 ? face + 2 : Math.max(1, face);
  }

  if (letter === "S" && have === 0) value += 6;
  else if (letter === "S" && have >= 2) value -= 4;

  const vowelRatio = vowels / Math.max(1, tiles);
  if (VOWELS.has(letter)) {
    if (vowelRatio < 0.22) value += 6;
    else if (vowelRatio < 0.32) value += 3;
    else if (vowelRatio > 0.55) value -= 4;
    if (have >= 3 && letter !== "E") value -= 3;
  } else if (vowelRatio < 0.18 && tiles >= 4) {
    value -= 2;
  }

  if (letter === "Q") {
    const u = ctx.myRack.get("U") ?? 0;
    const i = ctx.myRack.get("I") ?? 0;
    if (u === 0 && i === 0) value -= 6;
    else if (u === 0) value -= 2;
  }
  if (letter === "U" && (ctx.myRack.get("Q") ?? 0) > 0 && have === 0) {
    value += 10;
  }

  if (PREMIUM.has(letter) && have >= 1) {
    value = Math.min(value, Math.max(1, face - 2));
  }

  if (bag <= 8) {
    const now = ctx.dictionary
      ? bestPlay(ctx.myRack, ctx.dictionary, 2)
      : null;
    const next = ctx.dictionary
      ? bestPlay(withLetter(ctx.myRack, letter), ctx.dictionary, 2)
      : null;
    value = Math.max(0, (next?.reward ?? 0) - (now?.reward ?? 0));
    if (value === 0 && VOWELS.has(letter) && vowelRatio < 0.3) value = 2;
  }

  if (behind) value = Math.round(value * 1.15);

  value = Math.max(0, Math.round(value));
  if (value <= 0) return 0;

  const auctionType = ctx.auctionType ?? "Vickrey";
  let bid =
    auctionType === "FirstPrice" ? Math.max(1, Math.floor(value * 0.72)) : value;

  const capShare = behind ? 0.7 : 0.5;
  const cap = Math.max(1, Math.floor(Math.max(0, ctx.myBalance) * capShare));
  bid = Math.min(bid, cap, Math.max(0, ctx.myBalance));
  return bid;
}

export function chooseWord(ctx: WordContext): string | null {
  const tiles = rackTiles(ctx.myRack);
  const behind =
    ctx.opponentBestScore !== undefined &&
    ctx.myScore !== undefined &&
    ctx.myScore + 12 < ctx.opponentBestScore;
  const minLen = minPlayLength(tiles, ctx.bagTotal, ctx.myBalance, behind);

  const play = bestPlay(ctx.myRack, ctx.dictionary, minLen);
  if (play) return play.word;

  if (minLen > 2) {
    const fallback = bestPlay(ctx.myRack, ctx.dictionary, 2);
    if (!fallback) return null;
    const desperate =
      (ctx.myBalance ?? 100) < 10 ||
      tiles >= 11 ||
      (ctx.bagTotal ?? 40) <= 4 ||
      behind;
    if (desperate) return fallback.word;
  }
  return null;
}
