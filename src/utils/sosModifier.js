/**
 * SOS Auto-Modifier for Progressive JPEG Y-only scan duplication.
 * Automatically assigns the next valid progressive refinement pass
 * and generates valid all-EOB Huffman-encoded scan data.
 */

// Predefined Y-only progressive AC pass sequence
export const PASS_SEQUENCE = [
  { Ss: 1,  Se: 5,  Ah: 0, Al: 2 },
  { Ss: 6,  Se: 14, Ah: 0, Al: 2 },
  { Ss: 15, Se: 31, Ah: 0, Al: 2 },
  { Ss: 32, Se: 63, Ah: 0, Al: 2 },
  { Ss: 1,  Se: 63, Ah: 2, Al: 1 },
  { Ss: 1,  Se: 63, Ah: 1, Al: 0 },
];

/**
 * Scan file bytes for all existing Y-only SOS passes.
 */
function getExistingYPasses(fileData) {
  const view = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);
  const passes = [];
  let offset = 0;

  while (offset < fileData.length - 1) {
    if (fileData[offset] === 0xFF && fileData[offset + 1] === 0xDA) {
      const len = view.getUint16(offset + 2);
      const numComp = fileData[offset + 4];

      if (numComp === 1 && fileData[offset + 5] === 1) {
        const specPtr = offset + 4 + 1 + numComp * 2;
        passes.push({
          Ss: fileData[specPtr],
          Se: fileData[specPtr + 1],
          Ah: fileData[specPtr + 2] >> 4,
          Al: fileData[specPtr + 2] & 0x0F,
        });
      }
      // Skip past SOS header, scan data will be skipped by the outer loop
      offset += 2 + len;
    } else {
      offset++;
    }
  }
  return passes;
}

/**
 * Find the next unused pass from PASS_SEQUENCE.
 */
function getNextPass(existingPasses) {
  for (const pass of PASS_SEQUENCE) {
    const used = existingPasses.some(
      e => e.Ss === pass.Ss && e.Se === pass.Se && e.Ah === pass.Ah && e.Al === pass.Al
    );
    if (!used) return pass;
  }
  return null;
}

/**
 * Build Huffman code table from DHT counts and values.
 * Returns Map<symbol, { code, length }>
 */
function buildHuffmanCodes(counts16, values) {
  const codes = new Map();
  let code = 0;
  let vi = 0;

  for (let bits = 0; bits < 16; bits++) {
    for (let i = 0; i < counts16[bits]; i++) {
      codes.set(values[vi], { code, length: bits + 1 });
      code++;
      vi++;
    }
    code <<= 1;
  }
  return codes;
}

/**
 * Find an AC Huffman table in the file by table destination ID.
 * Returns the Huffman code Map or null.
 */
function findACHuffmanTable(fileData, tableId) {
  const view = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);
  let offset = 0;

  while (offset < fileData.length - 1) {
    if (fileData[offset] === 0xFF && fileData[offset + 1] === 0xC4) {
      const segLen = view.getUint16(offset + 2);
      let ptr = offset + 4;
      const segEnd = offset + 2 + segLen;

      while (ptr < segEnd) {
        const htInfo = fileData[ptr];
        const tableClass = htInfo >> 4;
        const destId = htInfo & 0x0F;

        const counts16 = [];
        let sumLen = 0;
        for (let i = 0; i < 16; i++) {
          const c = fileData[ptr + 1 + i];
          counts16.push(c);
          sumLen += c;
        }

        if (tableClass === 1 && destId === tableId) {
          const values = [];
          for (let i = 0; i < sumLen; i++) {
            values.push(fileData[ptr + 17 + i]);
          }
          return buildHuffmanCodes(counts16, values);
        }

        ptr += 1 + 16 + sumLen;
      }
      offset += 2 + segLen;
    } else {
      offset++;
    }
  }
  return null;
}

/**
 * Extract image dimensions and Y sampling factors from SOF marker.
 */
function getImageInfo(fileData) {
  const view = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);
  let offset = 0;

  while (offset < fileData.length - 1) {
    if (fileData[offset] === 0xFF) {
      const marker = fileData[offset + 1];

      // SOF markers: C0-CF except C4 (DHT), C8, CC
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        const height = view.getUint16(offset + 5);
        const width = view.getUint16(offset + 7);
        const numComp = fileData[offset + 9];

        let Hmax = 1, Vmax = 1, Hy = 1, Vy = 1;

        for (let i = 0; i < numComp; i++) {
          const compPtr = offset + 10 + i * 3;
          const compId = fileData[compPtr];
          const hv = fileData[compPtr + 1];
          const H = hv >> 4;
          const V = hv & 0x0F;
          if (H > Hmax) Hmax = H;
          if (V > Vmax) Vmax = V;
          if (compId === 1) { Hy = H; Vy = V; }
        }

        return { width, height, Hy, Vy, Hmax, Vmax };
      }

      // Skip markers
      if (marker === 0xD8 || marker === 0xD9) { offset += 2; continue; }
      if (marker >= 0xD0 && marker <= 0xD7) { offset += 2; continue; }
      if (marker === 0x00) { offset += 2; continue; }
      if (offset + 3 < fileData.length) {
        offset += 2 + view.getUint16(offset + 2);
      } else {
        offset++;
      }
    } else {
      offset++;
    }
  }
  return null;
}

/**
 * Calculate total Y blocks for a scan.
 * MCU grid = ceil(W / (8*Hmax)) × ceil(H / (8*Vmax))
 * Y blocks per MCU = Hy × Vy
 */
function calcYBlockCount(info) {
  const mcusX = Math.ceil(info.width / (8 * info.Hmax));
  const mcusY = Math.ceil(info.height / (8 * info.Vmax));
  return mcusX * mcusY * info.Hy * info.Vy;
}

/**
 * Generate all-EOB scan data for N blocks.
 * Packs Huffman-coded EOB symbols, pads last byte with 1-bits,
 * byte-stuffs any 0xFF.
 */
function generateEOBScanData(blockCount, eobCode) {
  let bitBuffer = 0;
  let bitsInBuffer = 0;
  const rawBytes = [];

  for (let i = 0; i < blockCount; i++) {
    bitBuffer = (bitBuffer << eobCode.length) | eobCode.code;
    bitsInBuffer += eobCode.length;

    while (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      rawBytes.push((bitBuffer >> bitsInBuffer) & 0xFF);
    }
  }

  // Pad remaining bits with 1-bits
  if (bitsInBuffer > 0) {
    const padded = (bitBuffer << (8 - bitsInBuffer)) | ((1 << (8 - bitsInBuffer)) - 1);
    rawBytes.push(padded & 0xFF);
  }

  // Byte-stuff: insert 0x00 after any 0xFF
  const stuffed = [];
  for (const b of rawBytes) {
    stuffed.push(b);
    if (b === 0xFF) stuffed.push(0x00);
  }

  return new Uint8Array(stuffed);
}

/**
 * Resolve the EOB Huffman code for the given AC table ID in the file.
 * Falls back to common defaults if table not found.
 */
function resolveEOBCode(fileData, acTableId) {
  const huffTable = findACHuffmanTable(fileData, acTableId);
  if (huffTable) {
    const eob = huffTable.get(0x00);
    if (eob) return eob;
  }
  // Fallback: standard Huffman EOB codes
  // Table 0: EOB = 1010 (4 bits), Table 1: EOB = 00 (2 bits)
  console.warn(`AC Huffman table ${acTableId} not found or missing EOB, using fallback`);
  return acTableId === 0
    ? { code: 0b1010, length: 4 }
    : { code: 0b00, length: 2 };
}

/**
 * Build a Y-only SOS header (10 bytes) for the given pass.
 * Preserves the AC table selector from the original.
 */
function buildSOSHeader(acTableSelector, pass) {
  const header = new Uint8Array(10);
  header[0] = 0xFF;
  header[1] = 0xDA;
  header[2] = 0x00; // length high byte
  header[3] = 0x08; // length = 8
  header[4] = 0x01; // 1 component
  header[5] = 0x01; // component ID = Y
  header[6] = acTableSelector; // DC:AC table selectors
  header[7] = pass.Ss;
  header[8] = pass.Se;
  header[9] = (pass.Ah << 4) | pass.Al;
  return header;
}

function concatArrays(a, b) {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

/**
 * Main entry: modify a pasted SOS block for the next progressive pass.
 *
 * @param {Uint8Array} originalSOSBytes - The copied SOS header bytes
 * @param {Uint8Array} fileData - Current file data (before insertion)
 * @returns {{ bytes: Uint8Array|null, pass: object|null, blockCount: number, error: string|null }}
 */
export function modifyPastedSOS(originalSOSBytes, fileData) {
  const existingPasses = getExistingYPasses(fileData);
  const nextPass = getNextPass(existingPasses);

  if (!nextPass) {
    return { bytes: null, pass: null, blockCount: 0, error: 'All 6 Y-only progressive passes already used' };
  }

  // Extract AC table selector from original SOS
  const numComp = originalSOSBytes[4];
  let acTableSelector = 0x00; // default: DC table 0, AC table 0
  if (numComp >= 1) {
    // For the first component, preserve its table selector byte
    acTableSelector = originalSOSBytes[6];
  }

  const sosHeader = buildSOSHeader(acTableSelector, nextPass);
  const acTableId = acTableSelector & 0x0F;
  const eobCode = resolveEOBCode(fileData, acTableId);

  const imageInfo = getImageInfo(fileData);
  let blockCount;
  if (imageInfo) {
    blockCount = calcYBlockCount(imageInfo);
  } else {
    console.warn('SOF not found, defaulting to 950 blocks');
    blockCount = 950;
  }

  const scanData = generateEOBScanData(blockCount, eobCode);
  const fullBlock = concatArrays(sosHeader, scanData);

  return {
    bytes: fullBlock,
    pass: nextPass,
    blockCount,
    error: null,
  };
}

export { getExistingYPasses, getNextPass, getImageInfo, calcYBlockCount };
