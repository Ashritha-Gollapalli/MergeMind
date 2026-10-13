import {
  FileCode2,
  FileText,
  Folder,
  Plus,
} from "lucide-react";

export default function FileExplorer({
  files = [],
  activeFileId,
  onSelectFile,
  onCreateFile,
  readOnly = false,
}) {
  function getIcon(file) {
    if (file.type === "folder") {
      return <Folder size={16} />;
    }

    if (/\.(html|css|js|jsx|ts|tsx)$/i.test(file.name)) {
      return <FileCode2 size={16} />;
    }

    return <FileText size={16} />;
  }

  return (
    <aside className="file-explorer">
      <div className="explorer-header">
        <span>EXPLORER</span>

        {!readOnly && (
          <button
            className="small-icon-button"
            onClick={onCreateFile}
            title="Create file"
            aria-label="Create file"
          >
            <Plus size={16} />
          </button>
        )}
      </div>

      <div className="explorer-project-name">
        <Folder size={15} />
        PROJECT FILES
      </div>

      <div className="file-list">
        {files.map((file) => (
          <button
            key={file._id || file.id}
            className={`file-item ${
              activeFileId === (file._id || file.id)
                ? "active"
                : ""
            }`}
            onClick={() => onSelectFile(file)}
          >
            {getIcon(file)}
            <span>{file.name}</span>
          </button>
        ))}

        {files.length === 0 && (
          <p className="empty-files">
            No files yet.
          </p>
        )}
      </div>
    </aside>
  );
}