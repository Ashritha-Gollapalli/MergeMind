const { spawn } = require("child_process");
const path = require("path");
const { randomUUID } = require("crypto");
const { build } = require("esbuild");

const SERVER_ROOT = path.resolve(__dirname, "..", "..");
const RESULT_MARKER = "__MERGEMIND_EXECUTION_RESULT__";
const EXECUTION_TIMEOUT_MS = 6000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const PROGRAM_RUNNERS = {
  python: {
    image: "python:3.13-alpine",
    sourceFile: "main.py",
    command: ["python", "/tmp/main.py"],
    memory: "128m",
    cpus: "0.5",
    timeoutMs: 10000,
    tmpfs: "16m",
  },
  java: {
    image: "eclipse-temurin:21-jdk-alpine",
    sourceFile: "Main.java",
    command: [
      "sh",
      "-c",
      "javac -d /tmp /tmp/Main.java && exec java -XX:+UseSerialGC -XX:MaxRAM=192m -XX:MaxRAMPercentage=50 -cp /tmp Main",
    ],
    memory: "256m",
    cpus: "1",
    timeoutMs: 15000,
    tmpfs: "32m",
  },
  c: {
    image: "gcc:14",
    sourceFile: "main.c",
    command: [
      "sh",
      "-c",
      "gcc -O0 -std=c17 /tmp/main.c -o /tmp/main && exec /tmp/main",
    ],
    memory: "256m",
    cpus: "1",
    timeoutMs: 15000,
    tmpfs: "32m",
  },
  cpp: {
    image: "gcc:14",
    sourceFile: "main.cpp",
    command: [
      "sh",
      "-c",
      "g++ -O0 -std=c++17 /tmp/main.cpp -o /tmp/main && exec /tmp/main",
    ],
    memory: "256m",
    cpus: "1",
    timeoutMs: 15000,
    tmpfs: "32m",
  },
  go: {
    image: "golang:1.25-alpine",
    sourceFile: "main.go",
    command: ["go", "run", "/tmp/main.go"],
    memory: "1g",
    cpus: "2",
    pids: 64,
    timeoutMs: 30000,
    tmpfs: "512m",
    environment: [
      "GOCACHE=/tmp/go-cache",
      "GOPATH=/tmp/go",
      "GOMAXPROCS=2",
      "GOFLAGS=-p=2",
      "GOTOOLCHAIN=local",
    ],
  },
  rust: {
    image: "rust:1.89-alpine",
    sourceFile: "main.rs",
    command: [
      "sh",
      "-c",
      "rustc -C debuginfo=0 /tmp/main.rs -o /tmp/main && exec /tmp/main",
    ],
    memory: "1g",
    cpus: "1",
    timeoutMs: 30000,
    tmpfs: "128m",
  },
  node: {
    image: "node:22-alpine",
    sourceFile: "main.js",
    command: ["node", "/tmp/main.js"],
    memory: "128m",
    cpus: "0.5",
    timeoutMs: 10000,
    tmpfs: "16m",
  },
};

class RunnerUnavailableError extends Error {}

function createWorkspacePlugin(appCode) {
  return {
    name: "mergemind-execution-workspace",
    setup(buildContext) {
      buildContext.onResolve({ filter: /^\.\/App\.jsx$/ }, () => ({
        path: "App.jsx",
        namespace: "workspace",
      }));
      buildContext.onResolve({ filter: /^\.\/App\.css$/ }, () => ({
        path: "App.css",
        namespace: "workspace",
      }));
      buildContext.onResolve(
        { filter: /.*/, namespace: "workspace" },
        (args) => {
          if (
            args.path === "react" ||
            args.path === "react/jsx-runtime"
          ) {
            return null;
          }

          return {
            errors: [
              {
                text: `Import "${args.path}" is not available in the execution sandbox.`,
              },
            ],
          };
        }
      );
      buildContext.onLoad(
        { filter: /.*/, namespace: "workspace" },
        (args) => ({
          contents: args.path === "App.jsx" ? appCode : "export {};",
          loader: args.path === "App.jsx" ? "jsx" : "js",
          resolveDir: SERVER_ROOT,
        })
      );
    },
  };
}

async function buildProjectBundle(appCode) {
  const runnerCode = `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import App from "./App.jsx";
    import "./App.css";

    const output = [];
    const errors = [];
    const formatValue = (value) => {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };

    console.log = (...values) => output.push(values.map(formatValue).join(" "));
    console.info = (...values) => output.push(values.map(formatValue).join(" "));
    console.warn = (...values) => errors.push(values.map(formatValue).join(" "));
    console.error = (...values) => errors.push(values.map(formatValue).join(" "));

    try {
      if (typeof App !== "function") {
        throw new Error("App.jsx must export a React component as its default export.");
      }

      const html = renderToStaticMarkup(React.createElement(App));
      process.stdout.write(${JSON.stringify(RESULT_MARKER)} + JSON.stringify({
        html,
        output: output.join("\\n"),
        errors: errors.join("\\n"),
      }) + "\\n");
    } catch (error) {
      process.stdout.write(${JSON.stringify(RESULT_MARKER)} + JSON.stringify({
        output: output.join("\\n"),
        errors: errors.join("\\n"),
        error: error?.stack || String(error),
      }) + "\\n");
    }
  `;

  const result = await build({
    bundle: true,
    format: "cjs",
    platform: "node",
    packages: "bundle",
    stdin: {
      contents: runnerCode,
      sourcefile: "runner-entry.jsx",
      resolveDir: SERVER_ROOT,
      loader: "jsx",
    },
    plugins: [createWorkspacePlugin(appCode)],
    jsx: "automatic",
    write: false,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
  });

  return result.outputFiles[0].contents;
}

function stopContainer(containerName) {
  const killer = spawn("docker", ["kill", containerName], {
    windowsHide: true,
    stdio: "ignore",
  });

  killer.on("error", (error) => {
    console.error("Could not stop timed-out code runner:", error);
  });
}

function runInDocker({
  image,
  command,
  input,
  memory = "128m",
  cpus = "0.5",
  pids = 32,
  timeoutMs = EXECUTION_TIMEOUT_MS,
  tmpfs = "16m",
  environment = [],
}) {
  const containerName = `mergemind-run-${randomUUID().replaceAll("-", "")}`;
  const args = [
    "run",
    "--interactive",
    "--rm",
    "--pull=never",
    `--name=${containerName}`,
    "--network=none",
    `--memory=${memory}`,
    `--memory-swap=${memory}`,
    `--cpus=${cpus}`,
    `--pids-limit=${pids}`,
    "--read-only",
    `--tmpfs=/tmp:rw,exec,nosuid,nodev,size=${tmpfs}`,
    "--init",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user=10001:10001",
    ...environment.map((value) => `--env=${value}`),
    image,
    ...command,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputExceeded = false;

    const terminate = () => {
      stopContainer(containerName);
      child.kill();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);

    const collect = (stream, chunk) => {
      if (timedOut || outputExceeded) return;

      const next = stream === "stdout" ? stdout + chunk : stderr + chunk;
      if (
        Buffer.byteLength(next, "utf8") +
          Buffer.byteLength(stream === "stdout" ? stderr : stdout, "utf8") >
        MAX_OUTPUT_BYTES
      ) {
        outputExceeded = true;
        terminate();
        return;
      }

      if (stream === "stdout") stdout = next;
      else stderr = next;
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") {
        console.error("Could not send code to the isolated runner:", error);
      }
    });
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") {
        reject(
          new RunnerUnavailableError(
            "Docker CLI was not found. Install Docker Desktop, ensure `docker` is on PATH, and restart the backend."
          )
        );
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, outputExceeded, stderr, stdout, timedOut });
    });

    child.stdin.end(input);
  });
}

function runReactBundle(bundle) {
  return runInDocker({
    image: "node:22-alpine",
    command: [
      "node",
      "-e",
      "const Module = require('node:module'); let source = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk) => { source += chunk; }); process.stdin.on('end', () => { const runner = new Module('/runner/bundle.cjs'); runner.filename = '/runner/bundle.cjs'; runner.paths = Module._nodeModulePaths('/runner'); runner._compile(source, runner.filename); });",
    ],
    input: bundle,
  });
}

async function executeReactProject({ appCode, cssCode }) {
  const bundle = await buildProjectBundle(appCode);
  const execution = await runReactBundle(bundle);

  if (execution.timedOut) {
    return {
      error: `Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000} seconds.`,
      html: "",
      output: execution.stdout.trim(),
    };
  }

  if (execution.outputExceeded) {
    return {
      error: "Execution output exceeded the 64 KB limit.",
      html: "",
      output: "",
    };
  }

  const markerIndex = execution.stdout.lastIndexOf(RESULT_MARKER);
  if (markerIndex < 0) {
    console.error("Code runner exited without a result:", execution.stderr);

    if (
      /cannot connect to the docker daemon|is the docker daemon running|error during connect|docker_engine/i.test(
        execution.stderr
      )
    ) {
      throw new RunnerUnavailableError(
        "Docker Desktop is installed but its engine is not running. Start Docker Desktop and wait until the engine is ready."
      );
    }

    if (
      /unable to find image|no such image|pull access denied|manifest unknown|failed to resolve reference/i.test(
        execution.stderr
      )
    ) {
      throw new RunnerUnavailableError(
        "The Node runner image is unavailable. Start Docker and run `docker pull node:22-alpine`."
      );
    }

    const details = execution.stderr.trim().slice(0, 400);
    throw new RunnerUnavailableError(
      details
        ? `The isolated code runner failed to start: ${details}`
        : "The isolated code runner failed to start. Confirm Docker Desktop is running and the node:22-alpine image is available."
    );
  }

  let result;
  try {
    const resultJson = execution.stdout
      .slice(markerIndex + RESULT_MARKER.length)
      .trim()
      .split(/\r?\n/, 1)[0];
    result = JSON.parse(resultJson);
  } catch (error) {
    console.error("Could not parse code runner output:", error);
    throw new RunnerUnavailableError(
      "The isolated code runner returned an invalid result."
    );
  }

  return {
    error: result.error || "",
    errors: [execution.stderr.trim(), result.errors].filter(Boolean).join("\n"),
    html: result.html || "",
    output: [execution.stdout.slice(0, markerIndex).trim(), result.output]
      .filter(Boolean)
      .join("\n"),
    css: cssCode,
  };
}

async function executeProgram({ language, source, stdin = "" }) {
  const runner = PROGRAM_RUNNERS[language];
  if (!runner) {
    throw new TypeError("Unsupported execution language.");
  }

  const sourceBuffer = Buffer.from(source, "utf8");
  const input = Buffer.concat([
    sourceBuffer,
    Buffer.from(stdin, "utf8"),
  ]);
  const execution = await runInDocker({
    ...runner,
    command: [
      "sh",
      "-c",
      'dd bs=1 count="$1" of="/tmp/$2" 2>/dev/null || exit 1; shift 2; exec "$@"',
      "mergemind",
      String(sourceBuffer.length),
      runner.sourceFile,
      ...runner.command,
    ],
    input,
  });

  if (execution.timedOut) {
    return {
      error: `Execution timed out after ${runner.timeoutMs / 1000} seconds.`,
      errors: execution.stderr.trim(),
      output: execution.stdout.trim(),
    };
  }

  if (execution.outputExceeded) {
    return {
      error: "Execution output exceeded the 64 KB limit.",
      errors: "",
      output: "",
    };
  }

  if (
    /cannot connect to the docker daemon|is the docker daemon running|error during connect|docker_engine/i.test(
      execution.stderr
    )
  ) {
    throw new RunnerUnavailableError(
      "Docker Desktop is installed but its engine is not running. Start Docker Desktop and wait until the engine is ready."
    );
  }

  if (
    /unable to find image|no such image|pull access denied|manifest unknown|failed to resolve reference/i.test(
      execution.stderr
    )
  ) {
    throw new RunnerUnavailableError(
      `The ${language} runner image is unavailable. Check your internet connection and run \`docker pull ${runner.image}\`.`
    );
  }

  if (execution.code !== 0) {
    return {
      error: `Execution failed (exit code ${execution.code ?? "unknown"}).`,
      errors: execution.stderr.trim(),
      output: execution.stdout.trim(),
    };
  }

  return {
    error: "",
    errors: execution.stderr.trim(),
    output: execution.stdout.trim(),
  };
}

module.exports = {
  RunnerUnavailableError,
  buildProjectBundle,
  executeProgram,
  executeReactProject,
};
