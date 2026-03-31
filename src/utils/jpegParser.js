export const MARKERS = {
  0xFFD8: 'M_SOI (FFD8h)',
  0xFFD9: 'M_EOI (FFD9h)',
  0xFFDA: 'M_SOS (FFDAh)',
  0xFFDB: 'M_DQT (FFDBh)',
  0xFFC4: 'M_DHT (FFC4h)',
  0xFFE0: 'M_APP0',
  0xFFE1: 'M_APP1',
  0xFFE2: 'M_APP2',
  0xFFFE: 'M_COMM'
};

for (let i = 0xFFC0; i <= 0xFFCF; i++) {
  if (i !== 0xFFC4 && i !== 0xFFC8 && i !== 0xFFCC) {
    MARKERS[i] = `M_SOF${i - 0xFFC0} (${i.toString(16).toUpperCase()}h)`;
  }
}

const getCompName = (id) => {
  switch(id) {
    case 1: return 'Y';
    case 2: return 'Cb';
    case 3: return 'Cr';
    case 4: return 'I';
    case 5: return 'Q';
    default: return `Unknown(${id})`;
  }
};

export function parseJPEG(buffer) {
  const view = new DataView(buffer);
  let offset = 0;

  const readString = (off, len) => {
    let str = '';
    for (let i = 0; i < len; i++) {
        const charCode = view.getUint8(off + i);
        if (charCode === 0) break;
        str += String.fromCharCode(charCode);
    }
    return str;
  };

  const toHex = (val) => val.toString(16).toUpperCase() + 'h';

  if (view.getUint16(offset) !== 0xFFD8) {
    throw new Error("Not a valid JPEG (Missing FFD8)");
  }

  const fileNode = {
    name: 'JPEG File',
    type: 'struct JPGFILE',
    start: 0,
    size: buffer.byteLength,
    children: []
  };

  fileNode.children.push({
    name: 'Start of Image (SOI)',
    value: MARKERS[0xFFD8],
    type: 'enum M_ID',
    start: offset,
    size: 2,
  });
  offset += 2;

  const counts = { dqt: 0, dht: 0, sof: 0, app: 0 };

  while (offset < buffer.byteLength) {
    let markerByte = view.getUint8(offset);
    if (markerByte !== 0xFF) {
      let padStart = offset;
      while (offset < buffer.byteLength && view.getUint8(offset) !== 0xFF) offset++;
      if (offset > padStart) {
        fileNode.children.push({ name: `Garbage Bytes [${offset - padStart}]`, value: '', type: 'char[]', start: padStart, size: offset - padStart });
      }
      if (offset >= buffer.byteLength) break;
    }
    
    let padStart = offset;
    while (offset < buffer.byteLength && view.getUint8(offset + 1) === 0xFF) offset++;
    if (offset > padStart) offset--;
    
    let markerVal = view.getUint16(offset);
    
    if (markerVal === 0xFFD9) {
      fileNode.children.push({ name: 'End of Image (EOI)', value: MARKERS[0xFFD9], type: 'enum M_ID', start: offset, size: 2 });
      break;
    }
    
    if (markerVal >= 0xFFD0 && markerVal <= 0xFFD7) {
      fileNode.children.push({ name: `Restart Marker (${markerVal - 0xFFD0})`, value: `M_RST${markerVal - 0xFFD0}`, type: 'enum M_ID', start: offset, size: 2 });
      offset += 2;
      continue;
    }

    const szSection = view.getUint16(offset + 2);
    const segmentSize = szSection + 2;
    let structType = 'struct SEGMENT';
    let baseName = `Segment`;

    if (markerVal >= 0xFFE0 && markerVal <= 0xFFEF) {
        structType = `struct APP${markerVal - 0xFFE0}`;
        baseName = `APP${markerVal - 0xFFE0} Payload`;
    } else if (markerVal === 0xFFDB) {
        structType = 'struct DQT';
        baseName = `Define Quantization Table (DQT) [${counts.dqt++}]`;
    } else if (markerVal === 0xFFC4) {
        structType = 'struct DHT';
        baseName = `Define Huffman Table (DHT) [${counts.dht++}]`;
    } else if (markerVal >= 0xFFC0 && markerVal <= 0xFFCF && markerVal !== 0xFFC4) {
        structType = 'struct SOFx';
        baseName = `Start of Frame (SOF${markerVal - 0xFFC0}) [${counts.sof++}]`;
    } else if (markerVal === 0xFFDA) {
        structType = 'struct SOS';
        baseName = `Start of Scan (SOS)`;
    } else if (markerVal === 0xFFFE) {
        structType = 'struct COMMENT';
        baseName = 'File Comment';
    }

    const segNode = {
      name: baseName,
      value: '',
      type: structType,
      start: offset,
      size: segmentSize,
      children: []
    };

    segNode.children.push({ name: 'Marker Signature', value: MARKERS[markerVal] || toHex(markerVal), type: 'enum M_ID', start: offset, size: 2 });
    segNode.children.push({ name: 'Segment Length', value: `${toHex(szSection)} (${szSection})`, type: 'WORD', start: offset + 2, size: 2 });

    let ptr = offset + 4;
    
    // APP0
    if (markerVal === 0xFFE0) {
        const id = readString(ptr, 5);
        segNode.children.push({ name: 'Identifier', value: id, type: 'char[5]', start: ptr, size: 5 });
        if (id.startsWith('JFIF')) {
            segNode.children.push({ name: 'JFIF Major Version', value: view.getUint8(ptr + 5).toString(), type: 'ubyte', start: ptr + 5, size: 1 });
            segNode.children.push({ name: 'JFIF Minor Version', value: view.getUint8(ptr + 6).toString(), type: 'ubyte', start: ptr + 6, size: 1 });
            const units = view.getUint8(ptr + 7);
            segNode.children.push({ name: 'Density Units', value: units.toString(), type: 'ubyte', start: ptr + 7, size: 1 });
            segNode.children.push({ name: 'X Density', value: view.getUint16(ptr + 8).toString(), type: 'WORD', start: ptr + 8, size: 2 });
            segNode.children.push({ name: 'Y Density', value: view.getUint16(ptr + 10).toString(), type: 'WORD', start: ptr + 10, size: 2 });
            const xT = view.getUint8(ptr + 12);
            const yT = view.getUint8(ptr + 13);
            segNode.children.push({ name: 'Thumbnail Width', value: xT.toString(), type: 'ubyte', start: ptr + 12, size: 1 });
            segNode.children.push({ name: 'Thumbnail Height', value: yT.toString(), type: 'ubyte', start: ptr + 13, size: 1 });
        }
    }

    // Comment
    if (markerVal === 0xFFFE) {
        const cLen = segmentSize - 4;
        const commentStr = readString(ptr, cLen);
        segNode.value = commentStr.length > 20 ? commentStr.slice(0, 17) + "..." : commentStr;
        segNode.children.push({ name: `Comment String [${cLen}]`, value: segNode.value, type: 'char[]', start: ptr, size: cLen });
    }

    // SOF
    if (markerVal >= 0xFFC0 && markerVal <= 0xFFCF && markerVal !== 0xFFC4) {
        segNode.children.push({ name: 'Sample Precision', value: view.getUint8(ptr).toString(), type: 'ubyte', start: ptr, size: 1 });
        segNode.children.push({ name: 'Image Height', value: view.getUint16(ptr + 1).toString(), type: 'WORD', start: ptr + 1, size: 2 });
        segNode.children.push({ name: 'Image Width', value: view.getUint16(ptr + 3).toString(), type: 'WORD', start: ptr + 3, size: 2 });
        const nr_comp = view.getUint8(ptr + 5);
        segNode.children.push({ name: 'Number of Components', value: nr_comp.toString(), type: 'ubyte', start: ptr + 5, size: 1 });
        ptr += 6;
        for (let i = 0; i < nr_comp; i++) {
            const compId = view.getUint8(ptr);
            const compStruct = { name: `Component (${getCompName(compId)})`, value: '', type: 'struct COMPS', start: ptr, size: 3, children: [] };
            compStruct.children.push({ name: 'Component ID', value: `${compId} (${getCompName(compId)})`, type: 'ubyte', start: ptr, size: 1 });
            const hv = view.getUint8(ptr + 1);
            compStruct.children.push({ name: 'Sampling Factors (H/V)', value: `${hv >> 4} / ${hv & 0x0F}`, type: 'ubyte bitfield', start: ptr + 1, size: 1 });
            compStruct.children.push({ name: 'Quantization Table ID', value: view.getUint8(ptr + 2).toString(), type: 'ubyte', start: ptr + 2, size: 1 });
            segNode.children.push(compStruct);
            ptr += 3;
        }
    }

    // DQT
    if (markerVal === 0xFFDB) {
        let qCount = 0;
        while (ptr < offset + segmentSize) {
            const pqTq = view.getUint8(ptr);
            const precisionPq = pqTq >> 4;
            const sizeQt = precisionPq === 0 ? 64 : 128;
            const tableClass = { name: `Quantization Table [${qCount++}]`, value: '', type: 'struct QuanTable', start: ptr, size: 1 + sizeQt, children: [] };
            tableClass.children.push({ name: 'Precision / Destination Info', value: `Pq: ${precisionPq}, Tq: ${pqTq & 0x0F}`, type: 'uchar bitfield', start: ptr, size: 1 });
            tableClass.children.push({ name: `Table Coefficients [${sizeQt}]`, value: '[...]', type: precisionPq === 0 ? 'byte[64]' : 'uint16[64]', start: ptr + 1, size: sizeQt });
            segNode.children.push(tableClass);
            ptr += (1 + sizeQt);
        }
    }

    // DHT
    if (markerVal === 0xFFC4) {
        let hCount = 0;
        while (ptr < offset + segmentSize) {
            const htInfo = view.getUint8(ptr);
            let sumLen = 0;
            for (let i = 0; i < 16; i++) {
                sumLen += view.getUint8(ptr + 1 + i);
            }
            const structSize = 1 + 16 + sumLen;
            const hTable = { name: `Huffman Table [${hCount++}]`, value: '', type: 'struct Huffmann_Table', start: ptr, size: structSize, children: [] };
            hTable.children.push({ name: 'Table Class / Destination', value: htInfo.toString(16).toUpperCase() + 'h', type: 'ubyte', start: ptr, size: 1 });
            hTable.children.push({ name: 'Code Length Counts [16]', value: '[...]', type: 'ubyte[16]', start: ptr + 1, size: 16 });
            if (sumLen > 0) {
                hTable.children.push({ name: `Huffman Values [${sumLen}]`, value: '[...]', type: `ubyte[${sumLen}]`, start: ptr + 17, size: sumLen });
            }
            segNode.children.push(hTable);
            ptr += structSize;
        }
    }

    fileNode.children.push(segNode);
    offset += segmentSize;

    // SOS + Entropy Scan
    if (markerVal === 0xFFDA) {
        ptr = segNode.start + 4;
        const nr_comp = view.getUint8(ptr);
        segNode.children.push({ name: 'Number of Components', value: nr_comp.toString(), type: 'ubyte', start: ptr, size: 1 });
        ptr += 1;
        for (let i = 0; i < nr_comp; i++) {
            const compId = view.getUint8(ptr);
            const cStr = { name: `Scan Component (${getCompName(compId)})`, value: '', type: 'struct COMPSOS', start: ptr, size: 2, children: [] };
            cStr.children.push({ name: 'Component ID', value: `${compId} (${getCompName(compId)})`, type: 'ubyte', start: ptr, size: 1 });
            const dcAc = view.getUint8(ptr + 1);
            cStr.children.push({ name: 'DC/AC Table Selectors', value: `${dcAc >> 4} / ${dcAc & 0x0F}`, type: 'ubyte bitfield', start: ptr + 1, size: 1 });
            segNode.children.push(cStr);
            ptr += 2;
        }
        segNode.children.push({ name: 'Start of Spectral Selection', value: view.getUint8(ptr).toString(), type: 'uchar', start: ptr, size: 1 });
        segNode.children.push({ name: 'End of Spectral Selection', value: view.getUint8(ptr + 1).toString(), type: 'uchar', start: ptr + 1, size: 1 });
        const ahal = view.getUint8(ptr + 2);
        segNode.children.push({ name: 'Successive Approximation (Ah/Al)', value: `${ahal >> 4} / ${ahal & 0x0F}`, type: 'uchar bitfield', start: ptr + 2, size: 1 });

        const scanStart = offset;
        while (offset < buffer.byteLength - 1) {
            if (view.getUint8(offset) === 0xFF) {
                const peek = view.getUint8(offset + 1);
                if (peek !== 0x00 && !(peek >= 0xD0 && peek <= 0xD7)) {
                    break;
                }
            }
            offset++;
        }
        
        if (offset > scanStart) {
            fileNode.children.push({
                name: `Compressed Image Data [${offset - scanStart}]`, value: '', type: 'char[]', start: scanStart, size: offset - scanStart
            });
        }
    }
  }
  
  return fileNode.children;
}
