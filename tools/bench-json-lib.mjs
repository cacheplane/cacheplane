// SPDX-License-Identifier: MIT

export function median(values) {
  if (values.length === 0) throw new Error('Cannot compute the median of an empty sample');
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function relativeMedianAbsoluteDeviation(values) {
  const center = median(values);
  if (center === 0) return 0;
  return median(values.map((value) => Math.abs(value - center))) / center;
}

export function repetitionsForTargetDuration(durationMs, targetMs = 20, maximum = 10_000) {
  if (durationMs <= 0) return maximum;
  return Math.max(1, Math.min(maximum, Math.ceil(targetMs / durationMs)));
}

export function nextPairedSampleCount(current) {
  if (current < 101) return 101;
  if (current < 301) return 301;
  return null;
}

export function medianConfidenceInterval(values) {
  if (values.length < 5) throw new Error('Median confidence intervals require at least five samples');
  const sorted = [...values].sort((left, right) => left - right);
  const center = (sorted.length - 1) / 2;
  const radius = 0.98 * Math.sqrt(sorted.length);
  const lowerIndex = Math.max(0, Math.floor(center - radius));
  const upperIndex = Math.min(sorted.length - 1, Math.ceil(center + radius));
  return {
    lower: sorted[lowerIndex],
    median: median(sorted),
    upper: sorted[upperIndex],
  };
}

export function measurementKey(entry) {
  return `${entry.implementation}/${entry.workload}/${entry.chunking}`;
}

export function comparisonExitCode(comparison) {
  if (comparison.regressions.length > 0) return 1;
  if (comparison.inconclusive.length > 0) return 2;
  return 0;
}

export function classifyPairedMeasurements(measurements, maxRegression = 0.1) {
  const threshold = 1 + maxRegression;
  return {
    passed: measurements.filter((entry) => entry.upperRatio <= threshold),
    inconclusive: measurements.filter(
      (entry) => entry.lowerRatio <= threshold && entry.upperRatio > threshold,
    ),
    regressions: measurements.filter((entry) => entry.lowerRatio > threshold),
  };
}

export function compareReports(
  baseline,
  candidate,
  { maxTimeRegression = 0.1, maxHeapRegression = 0.15, maxRelativeMad = 0.05 } = {},
) {
  validateComparableReports(baseline, candidate);
  const baselineByKey = new Map(
    baseline.measurements.map((entry) => [measurementKey(entry), entry]),
  );
  const regressions = [];
  const inconclusive = [];
  const skipped = [];

  for (const entry of candidate.measurements) {
    const key = measurementKey(entry);
    const previous = baselineByKey.get(key);
    if (entry.bytes !== previous.bytes || entry.chunks !== previous.chunks) {
      throw new Error(`${key} workload shape does not match the baseline`);
    }

    if (entry.relativeMad > maxRelativeMad || previous.relativeMad > maxRelativeMad) {
      inconclusive.push(`${key}: timing variance exceeded ${(maxRelativeMad * 100).toFixed(0)}%`);
    } else {
      const timeChange = entry.medianMs / previous.medianMs - 1;
      if (timeChange > maxTimeRegression) {
        regressions.push(
          `${key} time: ${previous.medianMs.toFixed(2)}ms -> ${entry.medianMs.toFixed(2)}ms (+${(timeChange * 100).toFixed(1)}%)`,
        );
      }
    }

    if (
      entry.retainedHeapRelativeMad > maxRelativeMad ||
      previous.retainedHeapRelativeMad > maxRelativeMad
    ) {
      inconclusive.push(`${key}: retained-heap variance exceeded ${(maxRelativeMad * 100).toFixed(0)}%`);
    } else if (entry.retainedHeapBytes < 16_384 || previous.retainedHeapBytes < 16_384) {
      skipped.push(`${key}: retained heap is below the 16 KiB measurement floor`);
    } else {
      const heapChange = entry.retainedHeapBytes / previous.retainedHeapBytes - 1;
      if (heapChange > maxHeapRegression) {
        regressions.push(
          `${key} retained heap: ${formatBytes(previous.retainedHeapBytes)} -> ${formatBytes(entry.retainedHeapBytes)} (+${(heapChange * 100).toFixed(1)}%)`,
        );
      }
    }
  }

  return { regressions, inconclusive, skipped };
}

export function parseOptions(args) {
  const valueAfter = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const samples = Number(valueAfter('--samples') ?? 31);
  if (!Number.isInteger(samples) || samples < 3) throw new Error('--samples must be an integer >= 3');
  const baseline = valueAfter('--baseline');
  if (baseline && samples < 30) throw new Error('Baseline comparisons require at least 30 samples');
  return {
    samples,
    output: valueAfter('--output'),
    baseline,
  };
}

function validateComparableReports(baseline, candidate) {
  if (baseline.schemaVersion !== 2 || candidate.schemaVersion !== 2) {
    throw new Error('Benchmark reports must use schemaVersion 2');
  }
  if (baseline.runtime !== candidate.runtime) throw new Error('Benchmark report runtime does not match');
  if (baseline.platform !== candidate.platform) throw new Error('Benchmark report platform does not match');
  if (baseline.samples < 30 || candidate.samples < 30 || baseline.samples !== candidate.samples) {
    throw new Error('Benchmark reports must use the same sample count of at least 30');
  }

  const baselineKeys = baseline.measurements.map(measurementKey).sort();
  const candidateKeys = candidate.measurements.map(measurementKey).sort();
  if (new Set(baselineKeys).size !== baselineKeys.length || new Set(candidateKeys).size !== candidateKeys.length) {
    throw new Error('Benchmark reports contain duplicate measurement keys');
  }
  if (JSON.stringify(baselineKeys) !== JSON.stringify(candidateKeys)) {
    throw new Error('Benchmark report measurement keys do not match');
  }

  for (const entry of [...baseline.measurements, ...candidate.measurements]) {
    for (const field of ['medianMs', 'relativeMad', 'retainedHeapBytes', 'retainedHeapRelativeMad']) {
      if (!Number.isFinite(entry[field]) || entry[field] < 0) {
        throw new Error(`Benchmark measurement ${measurementKey(entry)} has invalid ${field}`);
      }
    }
  }
}

function formatBytes(value) {
  return `${Math.round(value / 1024)} KiB`;
}
