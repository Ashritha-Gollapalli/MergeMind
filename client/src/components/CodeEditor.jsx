import Editor from "@monaco-editor/react";

export default function CodeEditor({
  file,
  value,
  onChange,
  readOnly = false,
}) {
  function getLanguage(filename = "") {
    const extension = filename.split(".").pop()?.toLowerCase();

    const languages = {
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      html: "html",
      css: "css",
      json: "json",
      py: "python",
      md: "markdown",
      xml: "xml",
    };

    return languages[extension] || "plaintext";
  }

  return (
    <div className="code-editor">
      <Editor
        height="100%"
        language={getLanguage(file?.name)}
        theme="vs-dark"
        value={value}
        onChange={(newValue) => onChange(newValue ?? "")}
        options={{
          readOnly,
          automaticLayout: true,
          fontSize: 14,
          tabSize: 2,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          padding: { top: 16 },
        }}
      />
    </div>
  );
}