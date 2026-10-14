
import { useState } from "react";
import Editor from "@monaco-editor/react";

function CodeEditor({ project, onBack }) {
  const [language, setLanguage] = useState("javascript");
  const [code, setCode] = useState(
    '// Welcome to MergeMind\n\nfunction hello() {\n  console.log("Hello, team!");\n}\n\nhello();\n'
  );

  return (
    <main className="code-workspace">
      <header className="editor-toolbar">
        <button
          className="button button-secondary"
          onClick={onBack}
        >
          ← Back to Project
        </button>

        <div className="editor-project-name">
          <strong>{project.name}</strong>
          <span>Collaborative editor</span>
        </div>

        <label className="language-picker">
          Language
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
            <option value="json">JSON</option>
          </select>
        </label>
      </header>

      <div className="editor-status">
        <span className="status-dot" />
        Local editor ready
      </div>

      <div className="monaco-container">
        <Editor
          height="100%"
          language={language}
          theme="vs-dark"
          value={code}
          onChange={(value) => setCode(value ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            padding: { top: 16 },
          }}
        />
      </div>

      <footer className="editor-footer">
        <span>{language}</span>
        <span>{code.split("\n").length} lines</span>
        <span>{code.length} characters</span>
      </footer>
    </main>
  );
}

export default CodeEditor;
