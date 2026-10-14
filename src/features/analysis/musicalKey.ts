export type KeyMode = "major" | "minor";

/** A musical key; pitchClass counts semitones up from C. */
export interface MusicalKey {
  pitchClass: number;
  mode: KeyMode;
}

export type KeyNotationStyle = "standard" | "camelot";

const majorNames = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

const minorNames = [
  "Cm",
  "C#m",
  "Dm",
  "Ebm",
  "Em",
  "Fm",
  "F#m",
  "Gm",
  "G#m",
  "Am",
  "Bbm",
  "Bm",
] as const;

const naturalPitchClasses = new Map([
  ["C", 0],
  ["D", 2],
  ["E", 4],
  ["F", 5],
  ["G", 7],
  ["A", 9],
  ["B", 11],
]);

const wrap = (value: number) => ((value % 12) + 12) % 12;

// Keys a fifth apart sit on neighbouring wheel numbers, and a minor key shares its number with
// the relative major three semitones above it.
const camelotNumber = ({ pitchClass, mode }: MusicalKey) =>
  wrap((mode === "minor" ? pitchClass + 3 : pitchClass) * 7 + 7) + 1;

const keyFromWheel = (majorWheelNumber: number, mode: KeyMode): MusicalKey => {
  const relativeMajor = wrap((majorWheelNumber - 8) * 7);

  return { pitchClass: mode === "minor" ? wrap(relativeMajor - 3) : relativeMajor, mode };
};

export const formatMusicalKey = (key: MusicalKey, style: KeyNotationStyle) =>
  style === "camelot"
    ? `${camelotNumber(key)}${key.mode === "minor" ? "A" : "B"}`
    : (key.mode === "minor" ? minorNames : majorNames)[wrap(key.pitchClass)]!;

/** Reads standard ("F#m", "Bb major"), camelot ("8A") and open key ("1m") spellings. */
export const parseMusicalKey = (text: string): MusicalKey | undefined => {
  const value = text.trim();
  const camelot = value.match(/^(1[0-2]|0?[1-9])\s*([ABab])$/u);

  if (camelot) {
    return keyFromWheel(Number(camelot[1]), camelot[2]!.toUpperCase() === "A" ? "minor" : "major");
  }

  const openKey = value.match(/^(1[0-2]|[1-9])\s*([DMdm])$/u);

  if (openKey) {
    // open key numbers the same wheel starting from C major instead of B major.
    const mode = openKey[2]!.toLowerCase() === "m" ? "minor" : "major";

    return keyFromWheel(Number(openKey[1]) + 7, mode);
  }

  const standard = value.match(/^([A-G])([#♯b♭]?)\s*(maj(?:or)?|min(?:or)?|m)?$/iu);
  const natural = standard ? naturalPitchClasses.get(standard[1]!.toUpperCase()) : undefined;

  if (!standard || natural === undefined) return undefined;
  const accidental = standard[2] === "" ? 0 : standard[2] === "#" || standard[2] === "♯" ? 1 : -1;
  const suffix = standard[3] ?? "";
  const minor = suffix === "m" || suffix.toLowerCase().startsWith("min");

  return {
    pitchClass: wrap(natural + accidental),
    mode: minor ? "minor" : "major",
  };
};
