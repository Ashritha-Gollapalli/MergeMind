import { create } from "zustand";

export const useAuthStore = create((set) => ({
  user: null,
  role: null,
  isAuthenticated: Boolean(localStorage.getItem("token")),

  setAuth: (user, token) => {
    localStorage.setItem("token", token);

    set({
      user,
      isAuthenticated: true,
    });
  },

  setRole: (role) => set({ role }),

  logout: () => {
    localStorage.removeItem("token");

    set({
      user: null,
      role: null,
      isAuthenticated: false,
    });
  },
}));