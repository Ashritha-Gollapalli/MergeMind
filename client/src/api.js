import { getApiUrl } from "./config/urls";

export async function apiRequest(path, options = {}, token = null) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      // The caller can handle an expired or invalid login.
    }

    throw new Error(data.message || `Request failed (${response.status})`);
  }

  return data;
}