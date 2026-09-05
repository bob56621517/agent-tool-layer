const MAXIMUM_LENGTH = 50000;

export function normalizedReadOptions(skip = 0, length = 5000): { skip: number; length: number } {
  const normalizedSkip = Number.isFinite(skip) ? Math.max(0, Math.floor(skip)) : 0;
  const normalizedLength = Number.isFinite(length)
    ? Math.min(MAXIMUM_LENGTH, Math.max(1, Math.floor(length)))
    : 5000;
  return { skip: normalizedSkip, length: normalizedLength };
}

export function sliceText(text: string, skip = 0, length = 5000): string {
  const options = normalizedReadOptions(skip, length);
  return text.slice(options.skip, options.skip + options.length);
}
