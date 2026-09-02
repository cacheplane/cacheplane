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
