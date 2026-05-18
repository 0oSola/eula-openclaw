export function computePeaks(samples, bucketCount) {
  const safeBucketCount = Math.max(1, Math.floor(bucketCount || 1));
  const bucketSize = Math.max(1, Math.ceil(samples.length / safeBucketCount));
  const peaks = [];
  for (let bucket = 0; bucket < safeBucketCount; bucket += 1) {
    let max = 0;
    const start = bucket * bucketSize;
    const end = Math.min(samples.length, start + bucketSize);
    for (let index = start; index < end; index += 1) {
      max = Math.max(max, Math.abs(samples[index] || 0));
    }
    peaks.push(Number(max.toFixed(4)));
  }
  return peaks;
}

export function seekTimeFromPointer({ clientX, left, width, duration }) {
  if (!duration || !width) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  return duration * ratio;
}
