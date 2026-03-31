import { useRef, useEffect, useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

const BYTES_PER_ROW = 16;

const resolvePath = (nodes, targetOffset, currentPath) => {
  if (!nodes) return null;
  for (const node of nodes) {
    if (node.start !== undefined && node.size !== undefined && 
        targetOffset >= node.start && targetOffset < node.start + node.size) {
      
      const newPath = currentPath ? `${currentPath} -> ${node.name}` : node.name;
      
      if (node.children && node.children.length > 0) {
        const childPath = resolvePath(node.children, targetOffset, newPath);
        if (childPath) return childPath;
      }
      return newPath;
    }
  }
  return null;
};

export default function HexViewer({ data, parsedData, selectedRange, onHexEdit }) {
  const parentRef = useRef();
  const [editingByte, setEditingByte] = useState(null);
  
  const numRows = Math.ceil(data.length / BYTES_PER_ROW);

  const rowVirtualizer = useVirtualizer({
    count: numRows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 20,
  });

  useEffect(() => {
    if (selectedRange && selectedRange.start !== undefined) {
      const topRow = Math.floor(selectedRange.start / BYTES_PER_ROW);
      rowVirtualizer.scrollToIndex(topRow, { align: 'center', behavior: 'smooth' });
    }
  }, [selectedRange, rowVirtualizer]);

  const isByteSelected = (byteIndex) => {
    if (!selectedRange) return false;
    return byteIndex >= selectedRange.start && byteIndex <= selectedRange.end;
  };

  return (
    <div ref={parentRef} style={{ height: '100%', overflow: 'auto', padding: '16px 24px' }}>
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.875rem',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const rowIndex = virtualRow.index;
          const startIndex = rowIndex * BYTES_PER_ROW;
          
          const hexOutput = [];
          const asciiOutput = [];

          for (let i = 0; i < BYTES_PER_ROW; i++) {
            const byteIndex = startIndex + i;
            
            if (byteIndex < data.length) {
              const byte = data[byteIndex];
              const isSelected = isByteSelected(byteIndex);
              
              const getByteStyle = (val, isSelected, index) => {
                if (isSelected) return { background: 'var(--hex-highlight)', color: '#fff', fontWeight: 600 };
                if (val === 0x00) return { color: 'var(--hex-zero)', opacity: 0.8 };
                if (val === 0xFF) return { color: 'var(--hex-marker)', fontWeight: 'bold' };
                if (index > 0 && data[index - 1] === 0xFF && val !== 0x00) return { color: 'var(--hex-marker)', fontWeight: 'bold' };
                
                return { color: 'var(--hex-text)' };
              };
              
              const hexStyle = getByteStyle(byte, isSelected, byteIndex);
                
              const toolTip = resolvePath(parsedData, byteIndex, '') || `Offset: ${byteIndex.toString(16).toUpperCase()}h`;

              if (editingByte === byteIndex) {
                 hexOutput.push(
                   <input
                     key={`edit-${i}`}
                     autoFocus
                     defaultValue={byte.toString(16).padStart(2, '0').toUpperCase()}
                     onBlur={(e) => {
                       onHexEdit(byteIndex, e.target.value);
                       setEditingByte(null);
                     }}
                     onKeyDown={(e) => {
                       if (e.key === 'Enter') {
                         onHexEdit(byteIndex, e.target.value);
                         setEditingByte(null);
                       } else if (e.key === 'Escape') {
                         setEditingByte(null);
                       }
                     }}
                     style={{ ...hexStyle, display: 'inline-block', width: '24px', textAlign: 'center', margin: '0 2px', border: 'none', outline: '1px solid var(--accent-hover)', background: 'var(--bg-color)', color: 'var(--text-primary)', padding: 0 }}
                   />
                 );
              } else {
                 hexOutput.push(
                   <span 
                     key={`hex-${i}`} 
                     title={`${toolTip} (Double click to edit)`}
                     onDoubleClick={() => setEditingByte(byteIndex)}
                     style={{ 
                       ...hexStyle, 
                       display: 'inline-block', 
                       width: '24px', 
                       textAlign: 'center', 
                       margin: '0 2px', 
                       borderRadius: '3px',
                       transition: 'background 0.1s',
                       cursor: 'text'
                     }}>
                     {byte.toString(16).padStart(2, '0').toUpperCase()}
                   </span>
                 );
              }

              const char = (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
              const asciiStyle = isSelected
                 ? { backgroundColor: 'var(--accent-color)', color: '#000', fontWeight: 'bold' }
                 : { color: 'var(--hex-ascii)' };

              asciiOutput.push(
                <span key={`asc-${i}`} title={toolTip} style={{ 
                  ...asciiStyle, 
                  display: 'inline-block', 
                  width: '12px', 
                  textAlign: 'center', 
                  margin: '0 1px', 
                  borderRadius: '2px',
                  opacity: (byte >= 32 && byte <= 126) ? 1 : 0.4
                }}>
                  {char}
                </span>
              );
            } else {
              hexOutput.push(<span key={`hex-${i}`} style={{ width: '28px', display: 'inline-block' }}></span>);
              asciiOutput.push(<span key={`asc-${i}`} style={{ width: '14px', display: 'inline-block' }}></span>);
            }
          }

          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: 'flex',
                alignItems: 'center',
                gap: '24px',
              }}
            >
              <div style={{ color: 'var(--hex-offset)', userSelect: 'none', fontWeight: 500 }}>
                {startIndex.toString(16).padStart(8, '0').toUpperCase()}
              </div>
              <div style={{ display: 'flex' }}>
                {hexOutput}
              </div>
              <div style={{ display: 'flex', marginLeft: 'auto' }}>
                {asciiOutput}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
