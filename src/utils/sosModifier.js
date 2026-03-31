/**
 * SOS Auto-Modifier for Progressive JPEG Y-only scan duplication.
 *
 * Parses actual DHT tables from the JPEG, respects DRI restart intervals,
 * and generates valid Huffman-encoded all-EOB scan data with proper
 * bit-packing, byte-stuffing, and RST marker insertion.
 */

// 12-pass Y-only progressive AC sequence.
// Initial scans (Ah=0) for each spectral band, then refinements.
// Ordering guarantees: initial before refinement for each Ss-Se range.
export const PASS_SEQUENCE = [
  { Ss: 1,  Se: 5,  Ah: 0, Al: 2 },   // band 1-5 initial
  { Ss: 6,  Se: 14, Ah: 0, Al: 2 },   // band 6-14 initial
  { Ss: 15, Se: 31, Ah: 0, Al: 2 },   // band 15-31 initial
  { Ss: 32, Se: 63, Ah: 0, Al: 2 },   // band 32-63 initial
  { Ss: 1,  Se: 5,  Ah: 2, Al: 1 },   // band 1-5 refine bit 1
  { Ss: 6,  Se: 14, Ah: 2, Al: 1 },   // band 6-14 refine bit 1
  { Ss: 15, Se: 31, Ah: 2, Al: 1 },   // band 15-31 refine bit 1
  { Ss: 32, Se: 63, Ah: 2, Al: 1 },   // band 32-63 refine bit 1
  { Ss: 1,  Se: 5,  Ah: 1, Al: 0 },   // band 1-5 final bit 0
  { Ss: 6,  Se: 14, Ah: 1, Al: 0 },   // band 6-14 final bit 0
  { Ss: 15, Se: 31, Ah: 1, Al: 0 },   // band 15-31 final bit 0
  { Ss: 32, Se: 63, Ah: 1, Al: 0 },   // band 32-63 final bit 0
];

// ---------------------------------------------------------------------------
// File scanning helpers
// ---------------------------------------------------------------------------

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
      offset += 2 + len;
      // Skip entropy-coded data after SOS
      while (offset < fileData.length - 1) {
        if (fileData[offset] === 0xFF) {
          const peek = fileData[offset + 1];
          if (peek !== 0x00 && !(peek >= 0xD0 && peek <= 0xD7)) break;
        }
        offset++;
      }
    } else {
      offset++;
    }
  }
  return passes;
}

/**
 * Find next valid pass, enforcing that initial scans (Ah=0)
 * for a spectral range must exist before refinements (Ah!=0).
 */
function getNextPass(existingPasses) {
  for (const pass of PASS_SEQUENCE) {
    const used = existingPasses.some(
      e => e.Ss === pass.Ss && e.Se === pass.Se && e.Ah === pass.Ah && e.Al === pass.Al
    );
    if (used) continue;

    // Refinement scans require their initial scan to already exist
    if (pass.Ah !== 0) {
      const hasInitial = existingPasses.some(
        e => e.Ss === pass.Ss && e.Se === pass.Se && e.Ah === 0
      );
      if (!hasInitial) continue;

      // Ah=1 refinement requires the Ah=2,Al=1 refinement to exist first
      if (pass.Ah === 1) {
        const hasMidRefine = existingPasses.some(
          e => e.Ss === pass.Ss && e.Se === pass.Se && e.Ah === 2 && e.Al === 1
        );
        if (!hasMidRefine) continue;
      }
    }

    return pass;
  }
  return null;
}

/**
 * Find the DRI (Define Restart Interval) value in the file.
 * Returns 0 if no DRI marker found.
 */
function findDRI(fileData) {
  const view = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);
  let offset = 0;

  while (offset < fileData.length - 3) {
    if (fileData[offset] === 0xFF && fileData[offset + 1] === 0xDD) {
      // FF DD 00 04 [restart_interval 16-bit BE]
      return view.getUint16(offset + 4);
    }
    offset++;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// DHT / Huffman code building
// ---------------------------------------------------------------------------

/**
 * Build Huffman code table from DHT counts and symbols.
 * Returns Map<symbol, { code: number, length: number }>
 *
 * Uses the canonical Huffman assignment algorithm from the JPEG spec:
 * codes are assigned in order of increasing bit length, incrementing
 * the code value for each symbol at the same length, then left-shifting
 * when moving to the next length.
 */
function buildHuffmanCodes(counts16, symbols) {
  const codes = new Map();
  let code = 0;
  let si = 0;

  for (let bits = 1; bits <= 16; bits++) {
    for (let i = 0; i < counts16[bits - 1]; i++) {
      codes.set(symbols[si], { code, length: bits });
      code++;
      si++;
    }
    code <<= 1;
  }
  return codes;
}

/**
 * Find an AC Huffman table in the file by destination ID.
 * Returns the code Map, or null if not found.
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
        const tableClass = htInfo >> 4; // 0 = DC, 1 = AC
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

// ---------------------------------------------------------------------------
// SOF / image geometry
// ---------------------------------------------------------------------------

/**
 * Extract image dimensions and Y sampling factors from the SOF marker.
 */
function getImageInfo(fileData) {
  const view = new DataView(fileData.buffer, fileData.byteOffset, fileData.byteLength);
  let offset = 0;

  while (offset < fileData.length - 1) {
    if (fileData[offset] === 0xFF) {
      const marker = fileData[offset + 1];

      if (marker >= 0xC0 && marker <= 0xCF &&
          marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        const height = view.getUint16(offset + 5);
        const width = view.getUint16(offset + 7);
        const numComp = fileData[offset + 9];

        let Hmax = 1, Vmax = 1, Hy = 1, Vy = 1;
        for (let i = 0; i < numComp; i++) {
          const p = offset + 10 + i * 3;
          const H = fileData[p + 1] >> 4;
          const V = fileData[p + 1] & 0x0F;
          if (H > Hmax) Hmax = H;
          if (V > Vmax) Vmax = V;
          if (fileData[p] === 1) { Hy = H; Vy = V; }
        }
        return { width, height, Hy, Vy, Hmax, Vmax };
      }

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
 * Total Y blocks in a non-interleaved scan.
 *
 * For component Y with sampling Hy × Vy in a frame with Hmax × Vmax:
 *   blocks_x = ceil(width  × Hy / (Hmax × 8))
 *   blocks_y = ceil(height × Vy / (Vmax × 8))
 *   total    = blocks_x × blocks_y
 *
 * This is equivalent to:
 *   mcusX × mcusY × Hy × Vy
 * where mcusX = ceil(width / (8*Hmax)), mcusY = ceil(height / (8*Vmax))
 */
function calcYBlockCount(info) {
  const mcusX = Math.ceil(info.width / (8 * info.Hmax));
  const mcusY = Math.ceil(info.height / (8 * info.Vmax));
  return mcusX * mcusY * info.Hy * info.Vy;
}

// ---------------------------------------------------------------------------
// Bit-level scan data generation with RST marker support
// ---------------------------------------------------------------------------

/**
 * Flush a bit array to output bytes with 0xFF byte-stuffing.
 * Pads the final byte with 1-bits per JPEG spec.
 */
function flushBits(bits, output) {
  // Pad to byte boundary with 1-bits
  while (bits.length % 8 !== 0) {
    bits.push(1);
  }

  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i + j];
    }
    output.push(byte);
    if (byte === 0xFF) {
      output.push(0x00); // byte-stuff
    }
  }
}

/**
 * Append a Huffman code (integer + bit length) to the bit array.
 */
function appendCode(bits, code, length) {
  for (let i = length - 1; i >= 0; i--) {
    bits.push((code >> i) & 1);
  }
}

/**
 * Generate valid Huffman-encoded scan data.
 *
 * Emits one EOB code per 8×8 block (symbol 0x00 in the AC Huffman table),
 * meaning all AC coefficients in the spectral range are zero.
 * Inserts RST markers at the DRI-specified interval.
 *
 * For non-interleaved (single-component) scans, each MCU = 1 data unit
 * (one 8×8 block), so the restart counter increments per block.
 *
 * @param {number}  blockCount      - Total Y blocks in the scan
 * @param {{ code: number, length: number }} eobCode - Huffman code for EOB
 * @param {number}  restartInterval - DRI value (0 = no restarts)
 * @returns {Uint8Array}
 */
function generateScanData(blockCount, eobCode, restartInterval) {
  const output = [];
  let bits = [];
  let mcuCounter = 0;
  let rstIndex = 0;

  for (let block = 0; block < blockCount; block++) {
    // Encode EOB for this block
    appendCode(bits, eobCode.code, eobCode.length);
    mcuCounter++;

    // Insert RST marker at restart interval boundary
    // (but not after the very last block — no trailing RST)
    if (restartInterval > 0 &&
        mcuCounter === restartInterval &&
        block < blockCount - 1) {
      // Flush accumulated bits (pad + byte-stuff)
      flushBits(bits, output);
      bits = [];

      // RST marker: FF D0 through FF D7, cycling
      output.push(0xFF, 0xD0 + (rstIndex & 7));
      rstIndex++;
      mcuCounter = 0;
    }
  }

  // Flush remaining bits after the last block
  if (bits.length > 0) {
    flushBits(bits, output);
  }

  return new Uint8Array(output);
}

// ---------------------------------------------------------------------------
// SOS header construction
// ---------------------------------------------------------------------------

/**
 * Build a 10-byte Y-only SOS header.
 *
 * Layout:
 *   FF DA           marker
 *   00 08           length = 8
 *   01              1 component
 *   01              component ID = Y
 *   Td:Ta           DC/AC table selectors (preserved from original)
 *   Ss Se Ah:Al     spectral selection & successive approximation
 */
function buildSOSHeader(tableSelector, pass) {
  return new Uint8Array([
    0xFF, 0xDA,
    0x00, 0x08,
    0x01,
    0x01,
    tableSelector,
    pass.Ss,
    pass.Se,
    (pass.Ah << 4) | pass.Al,
  ]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Modify a pasted SOS block for the next valid progressive pass.
 *
 * 1. Scans the file for existing Y-only passes
 * 2. Picks the next valid pass (respecting initial-before-refinement ordering)
 * 3. Reads the actual DHT AC table from the file for Huffman encoding
 * 4. Reads DRI for restart interval
 * 5. Computes Y block count from SOF
 * 6. Generates properly encoded scan data with RST markers
 *
 * @param {Uint8Array} originalSOSBytes - The copied SOS header bytes
 * @param {Uint8Array} fileData         - Current file data (before insertion)
 * @returns {{ bytes: Uint8Array|null, pass: object|null, blockCount: number,
 *             restartInterval: number, error: string|null }}
 */
export function modifyPastedSOS(originalSOSBytes, fileData) {
  const existingPasses = getExistingYPasses(fileData);
  const nextPass = getNextPass(existingPasses);

  if (!nextPass) {
    return {
      bytes: null, pass: null, blockCount: 0,
      restartInterval: 0,
      error: 'All 12 Y-only progressive passes already used',
    };
  }

  // Preserve DC/AC table selector byte from the original SOS
  const numComp = originalSOSBytes[4];
  let tableSelector = 0x00;
  if (numComp >= 1) {
    tableSelector = originalSOSBytes[6];
  }
  const acTableId = tableSelector & 0x0F;

  // --- Phase 1: Read DHT ---
  const huffTable = findACHuffmanTable(fileData, acTableId);
  let eobCode;
  if (huffTable && huffTable.has(0x00)) {
    eobCode = huffTable.get(0x00);
  } else {
    // Fallback to standard Huffman EOB codes if DHT not found
    console.warn(`AC Huffman table ${acTableId} not found or missing EOB — using fallback`);
    eobCode = acTableId === 0
      ? { code: 0b1010, length: 4 }
      : { code: 0b00, length: 2 };
  }

  // --- Phase 2: Read DRI ---
  const restartInterval = findDRI(fileData);

  // --- Phase 3: Calculate block count ---
  const imageInfo = getImageInfo(fileData);
  let blockCount;
  if (imageInfo) {
    blockCount = calcYBlockCount(imageInfo);
  } else {
    console.warn('SOF not found — defaulting to 650 blocks');
    blockCount = 650;
  }

  // --- Phase 4-6: Build SOS header + scan data ---
  const sosHeader = buildSOSHeader(tableSelector, nextPass);
  const scanData = generateScanData(blockCount, eobCode, restartInterval);

  // Concatenate header + scan data
  const fullBlock = new Uint8Array(sosHeader.length + scanData.length);
  fullBlock.set(sosHeader);
  fullBlock.set(scanData, sosHeader.length);

  return {
    bytes: fullBlock,
    pass: nextPass,
    blockCount,
    restartInterval,
    error: null,
  };
}

export { getExistingYPasses, getNextPass, getImageInfo, calcYBlockCount, findDRI };
