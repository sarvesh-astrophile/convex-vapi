/**
 * Vapi streams interleaved 16-bit stereo PCM: channel 0 is the caller and
 * channel 1 is the assistant. Sarvam needs mono PCM per session, so split the
 * interleaved frames without decoding them.
 */
export function splitStereo(buffer: ArrayBuffer): {
  customer: Uint8Array;
  assistant: Uint8Array;
} {
  const input = new Uint8Array(buffer);
  // 2 bytes per sample * 2 channels = 4 bytes per frame. Drop a trailing
  // partial frame instead of producing misaligned audio.
  const frames = Math.floor(input.length / 4);
  const customer = new Uint8Array(frames * 2);
  const assistant = new Uint8Array(frames * 2);

  for (let frame = 0; frame < frames; frame += 1) {
    const inputOffset = frame * 4;
    const outputOffset = frame * 2;
    customer[outputOffset] = input[inputOffset] ?? 0;
    customer[outputOffset + 1] = input[inputOffset + 1] ?? 0;
    assistant[outputOffset] = input[inputOffset + 2] ?? 0;
    assistant[outputOffset + 1] = input[inputOffset + 3] ?? 0;
  }

  return { customer, assistant };
}

/** Base64-encode PCM in bounded chunks so we never spread a huge array. */
export function toBase64(bytes: Uint8Array): string {
  const chunkSize = 0x2000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
