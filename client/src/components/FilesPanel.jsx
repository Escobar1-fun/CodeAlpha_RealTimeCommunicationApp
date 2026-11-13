import { Download, Paperclip } from 'lucide-react';
import { useRef, useState } from 'react';
import { downloadFile, uploadFile } from '../api.js';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function FilesPanel({ roomId, files }) {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  async function upload(file) {
    if (!file) return;
    setError('');
    setProgress(0);
    try {
      await uploadFile(roomId, file, setProgress);
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function download(file) {
    setError('');
    try {
      await downloadFile(roomId, file);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="panel-body">
      <ul className="file-list">
        {files.length === 0 && <li className="muted panel-empty">Files shared here are available to everyone until the meeting ends.</li>}
        {files.map((file) => (
          <li key={file.id}>
            <div>
              <strong title={file.name}>{file.name}</strong>
              <small className="muted">{formatSize(file.size)} · {file.uploadedBy.name}</small>
            </div>
            <button className="round small" aria-label={`Download ${file.name}`} onClick={() => download(file)}>
              <Download size={16} />
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="error panel-error" role="alert">{error}</p>}
      <div className="file-upload">
        {progress !== null && <progress value={progress} max={1} aria-label="Upload progress" />}
        <label className={`btn ${progress !== null ? 'disabled' : ''}`}>
          <Paperclip size={16} />
          {progress !== null ? 'Uploading…' : 'Share a file'}
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            disabled={progress !== null}
            onChange={(e) => upload(e.target.files[0])}
          />
        </label>
      </div>
    </div>
  );
}
