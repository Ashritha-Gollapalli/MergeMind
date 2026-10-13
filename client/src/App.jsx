import CodeEditor from "./components/CodeEditor";

export default function App() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0b0e14",
        color: "white",
      }}
    >
      <header style={{ padding: "16px" }}>
        <h2>CodeCollab Editor Test</h2>
      </header>

      <div style={{ flex: 1, minHeight: 0 }}>
        <CodeEditor
          file={{ name: "App.jsx" }}
          value={'function App() {\n  return "Hello CodeCollab";\n}'}
          onChange={(value) => console.log(value)}
        />
      </div>
    </div>
  );
}