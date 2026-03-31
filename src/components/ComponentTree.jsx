import { useState } from 'react';
import { ChevronRight, ChevronDown, MonitorDot, Edit2 } from 'lucide-react';
import './ComponentTree.css';

const TreeItem = ({ node, level, onSelect, onValueEdit, selectedNode, onMove }) => {
  const [expanded, setExpanded] = useState(false);
  const [dragOverPos, setDragOverPos] = useState(null);
  const hasChildren = node.children && node.children.length > 0;
  
  const isEditable = node.type === 'WORD' || node.type === 'ubyte' || node.type === 'uchar';
  const isSelected = selectedNode === node;

  const handleValueDoubleClick = () => {
    if (isEditable && node.start !== undefined && node.size !== undefined) {
      const newValue = prompt(`Edit ${node.name} (${node.type})\n\nCurrent Value: ${node.value}\nNew Value (decimal):`);
      if (newValue !== null && newValue.trim() !== '') {
         onValueEdit(node.start, node.size, node.type, newValue);
      }
    }
  };

  const handleDragStart = (e) => {
    e.stopPropagation();
    if (node.start === undefined || node.size === undefined) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('application/json', JSON.stringify({ start: node.start, size: node.size, name: node.name }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (node.start === undefined) return;
    
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    
    if (relY < rect.height / 2) {
      setDragOverPos('before');
    } else {
      setDragOverPos('after');
    }
  };

  const handleDragLeave = (e) => {
    setDragOverPos(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPos(null);
    try {
      const dragData = JSON.parse(e.dataTransfer.getData('application/json'));
      if (dragData.start !== undefined && node.start !== undefined) {
        onMove(dragData, node, dragOverPos || 'after');
      }
    } catch(err) {
      console.warn("Drag parse failed", err);
    }
  };

  return (
    <>
      <div 
        className={`table-tree-row ${isSelected ? 'row-selected' : ''} ${dragOverPos ? 'drag-over-' + dragOverPos : ''}`}
        draggable={node.start !== undefined}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (hasChildren) setExpanded(!expanded);
          if (node.start !== undefined && node.size !== undefined) {
            onSelect(node);
          }
        }}
      >
        <div className="col-name" style={{ paddingLeft: `${level * 16}px` }}>
          <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>
             {hasChildren ? (
              expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            ) : <MonitorDot size={10} color="var(--text-muted)" style={{opacity: 0.5}} />}
          </span>
          <span style={{ color: 'var(--text-primary)', marginLeft: 4 }}>{node.name}</span>
        </div>
        
        <div 
          className={`col-value ${isEditable ? 'editable' : ''}`} 
          title={isEditable ? `${node.value} (Double click to edit)` : node.value}
          onDoubleClick={handleValueDoubleClick}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: isEditable ? 'text' : 'pointer' }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.value || ''}</span>
          {isEditable && <Edit2 size={10} color="var(--accent-hover)" style={{ opacity: 0.3 }} />}
        </div>
        
        <div className="col-start">{node.start !== undefined ? `${node.start.toString(16).toUpperCase()}h` : ''}</div>
        <div className="col-size">{node.size !== undefined ? `${node.size.toString(16).toUpperCase()}h` : ''}</div>
        <div 
          className="col-type" 
          title={node.type} 
          style={{ 
             color: node.type && node.type.includes('struct') 
               ? 'var(--syntax-struct)' 
               : (node.type === 'char[]' || node.type === 'char[2]') 
                 ? 'var(--syntax-string)' 
                 : 'var(--syntax-primitive)' 
          }}
        >
          {node.type || ''}
        </div>
      </div>
      
      {expanded && hasChildren && (
        <>
          {node.children.map((child, idx) => (
            <TreeItem 
               key={idx} 
               node={child} 
               level={level + 1} 
               onSelect={onSelect} 
               onValueEdit={onValueEdit} 
               selectedNode={selectedNode} 
               onMove={onMove}
            />
          ))}
        </>
      )}
    </>
  );
};

export default function ComponentTree({ data, onSelect, onValueEdit, onCopy, onPaste, onDelete, onMove }) {
  const [selectedNode, setSelectedNode] = useState(null);

  if (!data) return null;

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      if (selectedNode) onCopy(selectedNode);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      if (selectedNode) onPaste(selectedNode);
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (selectedNode) onDelete(selectedNode);
    }
  };

  return (
    <div className="table-tree-container" tabIndex={0} onKeyDown={handleKeyDown} style={{ outline: 'none' }}>
      <div className="table-tree-header">
        <div>Name</div>
        <div>Value</div>
        <div>Start</div>
        <div>Size</div>
        <div>Type</div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 64 }}>
        {data.map((node, i) => (
          <TreeItem 
            key={i} 
            node={node} 
            level={0} 
            onSelect={(n) => {
               setSelectedNode(n);
               onSelect(n.start, n.size);
            }} 
            onValueEdit={onValueEdit} 
            selectedNode={selectedNode} 
            onMove={onMove}
          />
        ))}
      </div>
    </div>
  );
}
