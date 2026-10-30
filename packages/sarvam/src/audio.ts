export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  const chunkSize = 0x2000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Sarvam returns a base64 WAV; voice agents need headerless mono PCM. */
export function wavToPcm(wav: Uint8Array): Uint8Array {
  if (wav.byteLength < 12) {
    throw new Error("Invalid WAV: too short");
  }
  if (String.fromCharCode(...wav.subarray(0, 4)) !== "RIFF") {
    throw new Error("Invalid WAV: missing RIFF header");
  }

  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let offset = 12;
  while (offset + 8 <= wav.byteLength) {
    const id = String.fromCharCode(...wav.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      const start = offset + 8;
      return wav.subarray(start, Math.min(start + size, wav.byteLength));
    }
    offset += 8 + size + (size % 2);
  }

  throw new Error("Invalid WAV: missing data chunk");
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
