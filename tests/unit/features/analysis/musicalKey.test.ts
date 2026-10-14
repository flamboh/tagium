import { describe, expect, it } from "vite-plus/test";
import { formatMusicalKey, parseMusicalKey, type MusicalKey } from "@/features/analysis/musicalKey";

const wheel: Array<[camelot: string, standard: string]> = [
  ["1A", "G#m"],
  ["1B", "B"],
  ["2A", "Ebm"],
  ["2B", "F#"],
  ["3A", "Bbm"],
  ["3B", "Db"],
  ["4A", "Fm"],
  ["4B", "Ab"],
  ["5A", "Cm"],
  ["5B", "Eb"],
  ["6A", "Gm"],
  ["6B", "Bb"],
  ["7A", "Dm"],
  ["7B", "F"],
  ["8A", "Am"],
  ["8B", "C"],
  ["9A", "Em"],
  ["9B", "G"],
  ["10A", "Bm"],
  ["10B", "D"],
  ["11A", "F#m"],
  ["11B", "A"],
  ["12A", "C#m"],
  ["12B", "E"],
];

describe("musical key notation", () => {
  it.each(wheel)("maps %s to %s in both directions", (camelot, standard) => {
    const fromCamelot = parseMusicalKey(camelot);
    const fromStandard = parseMusicalKey(standard);
    expect(fromCamelot).toEqual(fromStandard);
    expect(formatMusicalKey(fromCamelot!, "standard")).toBe(standard);
    expect(formatMusicalKey(fromStandard!, "camelot")).toBe(camelot);
  });

  it.each<[string, MusicalKey]>([
    ["A minor", { pitchClass: 9, mode: "minor" }],
    ["Amin", { pitchClass: 9, mode: "minor" }],
    ["Abm", { pitchClass: 8, mode: "minor" }],
    ["D♭ major", { pitchClass: 1, mode: "major" }],
    ["Dbmaj", { pitchClass: 1, mode: "major" }],
    ["C♯m", { pitchClass: 1, mode: "minor" }],
    ["Cb", { pitchClass: 11, mode: "major" }],
    [" 08a ", { pitchClass: 9, mode: "minor" }],
    ["1d", { pitchClass: 0, mode: "major" }],
    ["1m", { pitchClass: 9, mode: "minor" }],
    ["6m", { pitchClass: 8, mode: "minor" }],
    ["12d", { pitchClass: 5, mode: "major" }],
    ["am", { pitchClass: 9, mode: "minor" }],
    ["a minor", { pitchClass: 9, mode: "minor" }],
    ["f#m", { pitchClass: 6, mode: "minor" }],
    ["bbm", { pitchClass: 10, mode: "minor" }],
    ["eb", { pitchClass: 3, mode: "major" }],
    ["AM", { pitchClass: 9, mode: "major" }],
  ])("reads the %s spelling", (text, key) => {
    expect(parseMusicalKey(text)).toEqual(key);
  });

  it.each(["", "H", "h", "13A", "0B", "8C", "A#x", "off"])("rejects %j", (text) => {
    expect(parseMusicalKey(text)).toBeUndefined();
  });
});
