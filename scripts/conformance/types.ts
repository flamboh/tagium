export type FixtureFamily = "mp3" | "flac" | "m4a";

export interface CanonicalFixtureMetadata {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly date: string;
  readonly genres: readonly string[];
  readonly trackNumber: number | null;
  readonly artworkCount: number;
}

export interface FixtureCase {
  readonly id: string;
  readonly family: FixtureFamily;
  readonly variant: string;
  readonly seed: number;
  readonly expected: "accepted" | "rejected";
  readonly features: readonly string[];
  readonly canonical: CanonicalFixtureMetadata | null;
  readonly fixtureSha256: string;
  readonly audioPayloadSha256: string | null;
  readonly byteLength: number;
}

export interface AssertionResult {
  readonly name: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly detail?: string;
}

export interface OracleResult {
  readonly oracle: "ffprobe" | "mutagen" | "taglib";
  readonly status: "passed" | "failed" | "skipped";
  readonly version?: string;
  readonly checkedCases: number;
  readonly detail?: string;
}

export interface MutationResult {
  readonly family: FixtureFamily;
  readonly requested: number;
  readonly completed: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly crashes: number;
  readonly digest: string;
}

export interface ConformanceReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly seed: number;
  readonly corpus: {
    readonly cases: number;
    readonly byFamily: Record<FixtureFamily, number>;
    readonly accepted: number;
    readonly adversarial: number;
    readonly manifestDigest: string;
  };
  readonly assertions: readonly AssertionResult[];
  readonly mutations: readonly MutationResult[];
  readonly oracles: readonly OracleResult[];
  readonly summary: {
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
  };
}
