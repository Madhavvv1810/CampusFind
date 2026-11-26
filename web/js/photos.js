// Photo handling in the browser, before anything is uploaded.

/**
 * Shrinks a phone photo to at most 1600 px as JPEG: faster on mobile data, and re-encoding
 * through a canvas drops EXIF metadata, including the GPS location the phone recorded.
 */
export async function preparePhoto(file, maxSide = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('This photo could not be read. Try a JPG or PNG.');
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
}

/**
 * 64-bit perceptual hash (DCT of a 32x32 greyscale copy, low frequencies vs. median).
 * Similar-looking photos get hashes a few bits apart; see matching.js photoSimilarity().
 */
export async function photoFingerprint(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, 32, 32);
  bitmap.close();
  const rgba = context.getImageData(0, 0, 32, 32).data;
  const gray = new Float32Array(1024);
  for (let i = 0; i < gray.length; i += 1) gray[i] = rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114;

  const coefficients = [];
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      let total = 0;
      for (let y = 0; y < 32; y += 1) {
        for (let x = 0; x < 32; x += 1) {
          total += gray[y * 32 + x] * Math.cos(((2 * x + 1) * u * Math.PI) / 64) * Math.cos(((2 * y + 1) * v * Math.PI) / 64);
        }
      }
      coefficients.push(total);
    }
  }
  const sorted = [...coefficients].sort((a, b) => a - b);
  const median = (sorted[31] + sorted[32]) / 2;
  const bits = coefficients.map(value => (value > median ? '1' : '0')).join('');
  return bits.match(/.{4}/g).map(nibble => parseInt(nibble, 2).toString(16)).join('');
}
