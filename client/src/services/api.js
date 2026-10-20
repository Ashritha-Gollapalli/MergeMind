import axios from "axios";
import { getApiUrl } from "../config/urls";

const api = axios.create({
  baseURL: getApiUrl(),
  timeout: 10000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

export default api;