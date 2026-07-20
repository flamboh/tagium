export interface AllocationMetrics {
  bytesRead: number;
  copiedBytes: number;
  largestRead: number;
  peakAllocatedBytes: number;
  maxConcurrency: number;
}

export interface TimingSummary {
  samplesMs: number[];
  medianMs: number;
  throughputMiBPerSecond: number;
}

export interface ScanResult {
  timing: TimingSummary;
  instrumentation: AllocationMetrics;
  processMemory: {
    beforeHeapUsedBytes: number;
    afterHeapUsedBytes: number;
    beforeRssBytes: number;
    afterRssBytes: number;
    beforeArrayBuffersBytes: number;
    afterArrayBuffersBytes: number;
  };
}

export interface CorpusDescription {
  files: number;
  bytesPerFile: number;
  totalBytes: number;
  seed: number;
}

export interface BenchmarkReport {
  schemaVersion: 1;
  generatedAt: string;
  gitCommit: string;
  runtime: {
    bun: string;
    platform: string;
    arch: string;
    cpu: string;
    logicalCpus: number;
    totalMemoryBytes: number;
  };
  configuration: {
    measuredRuns: number;
    warmupRuns: number;
    candidateConcurrency: number;
    maximumRangeReadBytes: number;
    sourceRevision: string;
  };
  corpus: { large: CorpusDescription; small: CorpusDescription };
  results: {
    large: { legacy: ScanResult; candidate: ScanResult };
    small: { legacy: ScanResult; candidate: ScanResult };
    interaction: { samplesMs: number[]; p95Ms: number };
  };
  comparisons: {
    largeThroughputRatio: number;
    peakAllocationReduction: number;
    smallThroughputRegression: number;
    smallWallClockRegression: number;
    smallCopiedWorkRegression: number;
  };
  gates: {
    largeThroughputAtLeast5x: boolean;
    peakAllocationAtLeast75PercentLower: boolean;
    smallRegressionAtMost10Percent: boolean;
    smallWallClockAtMost10PercentBestEffort: boolean;
    interactionP95Below50Ms: boolean;
    largestReadAtMost8MiB: boolean;
    passed: boolean;
  };
  limitations: string[];
}
