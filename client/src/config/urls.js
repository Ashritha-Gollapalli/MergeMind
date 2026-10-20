const defaultApiUrl = import.meta.env.PROD
  ? `${window.location.origin}/api`
  : "http://localhost:5000/api";
const API_URL = (import.meta.env.VITE_API_URL || defaultApiUrl).replace(
  /\/+$/,
  ""
);

export function getApiUrl() {
  return API_URL;
}

export function getSocketUrl() {
  return (
    import.meta.env.VITE_SOCKET_URL ||
    API_URL.replace(/\/api$/i, "")
  ).replace(/\/+$/, "");
}
