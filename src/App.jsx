import { useState, useCallback } from 'react';
import { FileSearch, XCircle, ClipboardType, Download } from 'lucide-react';
import FileUpload from './components/FileUpload';
import HexViewer from './components/HexViewer';
import ComponentTree from './components/ComponentTree';
import { parseJPEG } from './utils/jpegParser';
import { modifyPastedSOS } from './utils/sosModifier';

function App() {
  const [fileData, setFileData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [parsedData, setParsedData] = useState(null);
  const [selectedRange, setSelectedRange] = useState(null);
  const [clipboard, setClipboard] = useState(null); // { node, bytes }
  const [toastMsg, setToastMsg] = useState('');

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const handleUpload = (buffer, name) => {
    try {
      setFileName(name);
      setFileData(new Uint8Array(buffer));
      const parsed = parseJPEG(buffer);
      setParsedData(parsed);
      setSelectedRange(null);
      setClipboard(null);
    } catch (e) {
      console.error(e);
      alert("Error parsing JPEG: " + e.message);
      handleClear();
    }
  };

  const handleClear = () => {
    setFileData(null);
    setFileName('');
    setParsedData(null);
    setSelectedRange(null);
    setClipboard(null);
  };

  const handleSaveFile = () => {
    if (!fileData) return;
    try {
      const blob = new Blob([fileData], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `forged_${fileName}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("File downloaded successfully!");
    } catch (e) {
      alert("Failed to save file: " + e.message);
    }
  };

  const handleSelectRange = (offset, length) => {
    setSelectedRange({ start: offset, end: offset + length - 1 });
  };

  const handleHexEdit = useCallback((offset, newHexValueStr) => {
    const newVal = parseInt(newHexValueStr, 16);
    if (isNaN(newVal) || newVal < 0 || newVal > 255) return;
    
    setFileData((prevData) => {
      const newData = new Uint8Array(prevData);
      newData[offset] = newVal;
      try {
        setParsedData(parseJPEG(newData.buffer));
      } catch (e) {
        console.warn("Parse failure on edit, staying robust.", e);
      }
      return newData;
    });
  }, []);

  const handleValueEdit = useCallback((offset, size, type, newValueString) => {
    setFileData((prevData) => {
      const newData = new Uint8Array(prevData);
      const dataView = new DataView(newData.buffer);

      try {
        const val = parseInt(newValueString, 10);
        if (isNaN(val)) throw new Error("Not a generic number");

        if (type === 'WORD' && size === 2) {
          dataView.setUint16(offset, val);
        } else if ((type === 'ubyte' || type === 'uchar') && size === 1) {
          dataView.setUint8(offset, val);
        } else {
           console.warn(`Editing ${type} not supported yet`);
           return prevData;
        }

        setParsedData(parseJPEG(newData.buffer));
        showToast(`Updated value at offset ${offset.toString(16).toUpperCase()}h`);
        return newData;
      } catch (e) {
        alert("Failed to overwrite structure: " + e.message);
        return prevData;
      }
    });
  }, []);

  const handleCopy = useCallback((node) => {
    if (fileData && node && node.start !== undefined && node.size !== undefined) {
      const bytes = new Uint8Array(fileData.buffer.slice(node.start, node.start + node.size));
      setClipboard({ node, bytes });
      showToast(`Copied ${node.name} (${bytes.length} bytes)`);
    }
  }, [fileData]);

  const handlePaste = useCallback((targetNode) => {
    if (!clipboard || !fileData || !targetNode || targetNode.start === undefined) return;
    
    setFileData((prevData) => {
      let insertOffset = targetNode.start + targetNode.size;
      let payloadBytes = clipboard.bytes;
      
      // SOS Auto-Modifier: When pasting a Y-only SOS, auto-assign the next
      // progressive refinement pass and generate valid all-EOB scan data.
      let sosPassInfo = null;
      if (clipboard.node.type === 'struct SOS') {
        const result = modifyPastedSOS(payloadBytes, new Uint8Array(prevData));
        if (result.error) {
          console.warn('SOS Modifier:', result.error);
          // Fallback: append 0x00 if original behavior needed
          if (payloadBytes[payloadBytes.length - 1] !== 0x00) {
            const extended = new Uint8Array(payloadBytes.length + 1);
            extended.set(payloadBytes);
            extended[payloadBytes.length] = 0x00;
            payloadBytes = extended;
          }
        } else {
          payloadBytes = result.bytes;
          sosPassInfo = result.pass;
          console.log(`SOS Auto-Modifier: Assigned pass Ss=${sosPassInfo.Ss} Se=${sosPassInfo.Se} Ah=${sosPassInfo.Ah} Al=${sosPassInfo.Al} (${result.blockCount} EOB blocks, ${payloadBytes.length} bytes)`);
        }
      }

      const newData = new Uint8Array(prevData.length + payloadBytes.length);
      newData.set(new Uint8Array(prevData.buffer.slice(0, insertOffset)), 0);
      newData.set(payloadBytes, insertOffset);
      newData.set(new Uint8Array(prevData.buffer.slice(insertOffset)), insertOffset + payloadBytes.length);

      // Backtrack Header Fix / Patching Algorithm
      const dataView = new DataView(newData.buffer);
      let parentSeg = null;
      
      for (const seg of parsedData) {
        if (seg.type === 'struct JPGFILE') continue;
        if (targetNode.start >= seg.start && (targetNode.start + targetNode.size) <= (seg.start + seg.size)) {
            if (targetNode.start === seg.start && targetNode.size === seg.size) {
                // Target is the segment itself, pasting OUTSIDE/AFTER. No header patching required.
            } else {
                // Target is inside the segment. Pasting INSIDE/AFTER CHILD. Parent size must grow.
                parentSeg = seg;
                break;
            }
        }
      }

      if (parentSeg) {
          // The 16-bit word at parentSeg.start + 2 is the length.
          const oldLen = dataView.getUint16(parentSeg.start + 2);
          dataView.setUint16(parentSeg.start + 2, oldLen + payloadBytes.length);
          console.log(`Structured Paste applied: Patched ${parentSeg.name} from ${oldLen} to ${oldLen + payloadBytes.length}`);
      }

      try {
        setParsedData(parseJPEG(newData.buffer));
        const sosLabel = sosPassInfo ? ` [Y AC Ss=${sosPassInfo.Ss}..${sosPassInfo.Se} Ah=${sosPassInfo.Ah} Al=${sosPassInfo.Al}]` : '';
        showToast(`Pasted ${clipboard.node.name}${sosLabel}${parentSeg ? ` (Patched ${parentSeg.name} size)` : ''}`);
      } catch (e) {
        console.warn("Parse failure on paste", e);
      }
      return newData;
    });
  }, [clipboard, parsedData]);

  const handleDelete = useCallback((targetNode) => {
    if (!fileData || !targetNode || targetNode.start === undefined) return;
    
    setFileData((prevData) => {
      let deleteOffset = targetNode.start;
      let deleteSize = targetNode.size;

      const newData = new Uint8Array(prevData.length - deleteSize);
      newData.set(new Uint8Array(prevData.buffer.slice(0, deleteOffset)), 0);
      newData.set(new Uint8Array(prevData.buffer.slice(deleteOffset + deleteSize)), deleteOffset);

      const dataView = new DataView(newData.buffer);
      let parentSeg = null;
      
      for (const seg of parsedData) {
        if (seg.type === 'struct JPGFILE') continue;
        if (targetNode.start >= seg.start && (targetNode.start + targetNode.size) <= (seg.start + seg.size)) {
            if (targetNode.start === seg.start && targetNode.size === seg.size) {
                // Deleting the segment itself entirely.
            } else {
                parentSeg = seg;
                break;
            }
        }
      }

      if (parentSeg) {
          const oldLen = dataView.getUint16(parentSeg.start + 2);
          const newLen = Math.max(0, oldLen - deleteSize);
          dataView.setUint16(parentSeg.start + 2, newLen);
          console.log(`Structured Delete applied: Patched ${parentSeg.name} from ${oldLen} to ${newLen}`);
      }

      try {
        setParsedData(parseJPEG(newData.buffer));
        showToast(`Deleted ${targetNode.name}${parentSeg ? ` (Patched ${parentSeg.name} size)` : ''}`);
        setSelectedRange(null);
      } catch (e) {
        console.warn("Parse failure on delete", e);
      }
      return newData;
    });
  }, [fileData, parsedData]);

  const handleMove = useCallback((dragNode, dropNode, placement) => {
    if (!fileData || !dragNode || !dropNode || dragNode === dropNode) return;
    
    setFileData((prevData) => {
      const dragBytes = new Uint8Array(prevData.buffer.slice(dragNode.start, dragNode.start + dragNode.size));
      
      const tempBuf = new Uint8Array(prevData.length - dragNode.size);
      tempBuf.set(new Uint8Array(prevData.buffer.slice(0, dragNode.start)), 0);
      tempBuf.set(new Uint8Array(prevData.buffer.slice(dragNode.start + dragNode.size)), dragNode.start);

      let srcParent = null;
      for (const seg of parsedData) {
          if (seg.type === 'struct JPGFILE') continue;
          if (dragNode.start >= seg.start && (dragNode.start + dragNode.size) <= (seg.start + seg.size)) {
              if (dragNode.start !== seg.start || dragNode.size !== seg.size) {
                  srcParent = seg; break; 
              }
          }
      }

      if (srcParent) {
         const v = new DataView(tempBuf.buffer);
         const oldLen = v.getUint16(srcParent.start + 2);
         v.setUint16(srcParent.start + 2, Math.max(0, oldLen - dragNode.size));
      }

      let targetOffset = dropNode.start;
      if (placement === 'after') targetOffset += dropNode.size;
      
      if (dropNode.start > dragNode.start) {
          targetOffset -= dragNode.size;
      }
      
      const finalBuf = new Uint8Array(tempBuf.length + dragBytes.length);
      finalBuf.set(new Uint8Array(tempBuf.buffer.slice(0, targetOffset)), 0);
      finalBuf.set(dragBytes, targetOffset);
      finalBuf.set(new Uint8Array(tempBuf.buffer.slice(targetOffset)), targetOffset + dragBytes.length);

      let targetParent = null;
      for (const seg of parsedData) {
           if (seg.type === 'struct JPGFILE') continue;
           if (dropNode.start >= seg.start && (dropNode.start + dropNode.size) <= (seg.start + seg.size)) {
                if (dropNode.start !== seg.start || dropNode.size !== seg.size) {
                    targetParent = seg; break;
                }
           }
      }

      if (targetParent) {
           const v = new DataView(finalBuf.buffer);
           let newSegStart = targetParent.start;
           if (dragNode.start < targetParent.start) {
                newSegStart -= dragNode.size;
           }
           const oldLen = v.getUint16(newSegStart + 2);
           v.setUint16(newSegStart + 2, oldLen + dragNode.size);
           console.log(`Structured DnD applied: Patched ${targetParent.name} from ${oldLen} to ${oldLen + dragNode.size}`);
      }

      try {
        setParsedData(parseJPEG(finalBuf.buffer));
        showToast(`Moved ${dragNode.name} securely!`);
        setSelectedRange(null);
      } catch (e) {
        console.warn("Parse failure on Move Drop", e);
      }
      return finalBuf;
    });
  }, [fileData, parsedData]);

  return (
    <div className="app-container">
      {toastMsg && (
        <div style={{ position: 'absolute', top: 16, right: 16, background: 'var(--accent-color)', color: '#000', padding: '8px 16px', borderRadius: '4px', fontWeight: 'bold', zIndex: 1000, display: 'flex', alignItems: 'center', gap: 8 }}>
           <ClipboardType size={16} /> {toastMsg}
        </div>
      )}
      
      <header className="app-header glass-panel">
        <h1>
          <FileSearch color="var(--accent-color)" size={28} /> 
          <span className="title-gradient">JPEGForge</span>
        </h1>
        {fileData && (
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', padding: '4px 12px', background: 'var(--bg-panel-solid)', borderRadius: '12px' }}>
              {fileName} ({(fileData.length / 1024).toFixed(1)} KB)
            </span>
            <button className="btn-primary" onClick={handleSaveFile}>
              <Download size={18} /> Save As
            </button>
            <button className="btn-primary" onClick={handleClear} style={{ background: 'transparent', boxShadow: 'none', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
              <XCircle size={18} /> Clear
            </button>
          </div>
        )}
      </header>

      {fileData ? (
        <div className="app-workspace glass-panel">
          <div style={{ flex: '1 1 50%', height: '100%', minWidth: 0, borderRight: '1px solid var(--border-color)' }}>
            <HexViewer 
               data={fileData} 
               parsedData={parsedData} 
               selectedRange={selectedRange} 
               onHexEdit={handleHexEdit} 
            />
          </div>
          <div style={{ flex: '1 1 50%', height: '100%', minWidth: 0 }}>
            <ComponentTree 
               data={parsedData} 
               onSelect={handleSelectRange} 
               onValueEdit={handleValueEdit}
               onCopy={handleCopy}
               onPaste={handlePaste}
               onDelete={handleDelete}
               onMove={handleMove}
            />
          </div>
        </div>
      ) : (
        <FileUpload onUpload={handleUpload} />
      )}
    </div>
  );
}

export default App;
