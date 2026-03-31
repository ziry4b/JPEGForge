import { useState, useRef } from 'react';
import { UploadCloud } from 'lucide-react';

export default function FileUpload({ onUpload }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const onButtonClick = () => {
    fileInputRef.current.click();
  };

  const handleFile = (file) => {
    // Basic check for JPEG extension or MIME type
    if (!file.name.match(/\.(jpg|jpeg)$/i) && file.type !== 'image/jpeg') {
      alert("Please upload a valid JPEG file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      onUpload(e.target.result, file.name);
    };
    reader.onerror = () => {
      alert("Error reading file");
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div 
      className={`upload-container glass-panel ${isDragging ? 'drag-active' : ''}`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      onClick={onButtonClick}
    >
      <input 
        ref={fileInputRef} 
        type="file" 
        accept=".jpg,.jpeg,image/jpeg" 
        multiple={false} 
        onChange={handleChange} 
        style={{ display: 'none' }} 
      />
      <UploadCloud size={64} className="upload-icon" strokeWidth={1.5} />
      <div className="upload-text">Drag and drop a JPEG file here</div>
      <div className="upload-subtext">or click to browse from your computer</div>
    </div>
  );
}
