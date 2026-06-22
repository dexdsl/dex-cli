import React, { createContext, useContext, useState, useCallback } from "react";
import type { Env } from "./domain";

type Toast = { id: number; kind: "ok" | "err"; text: string };

type Store = {
  env: Env;
  setEnv: (env: Env) => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
  toast: Toast | null;
  notify: (kind: "ok" | "err", text: string) => void;
  siteRoot: string;
  setSiteRoot: (root: string) => void;
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [env, setEnvState] = useState<Env>(() => (localStorage.getItem("dx.env") as Env) || "test");
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("dx.theme") as "light" | "dark") || "light",
  );
  const [toast, setToast] = useState<Toast | null>(null);
  const [siteRoot, setSiteRoot] = useState("");

  const setEnv = useCallback((next: Env) => {
    setEnvState(next);
    localStorage.setItem("dx.env", next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem("dx.theme", next);
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }, []);

  const notify = useCallback((kind: "ok" | "err", text: string) => {
    const id = Date.now();
    setToast({ id, kind, text });
    window.setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), 5000);
  }, []);

  return (
    <Ctx.Provider
      value={{ env, setEnv, theme, toggleTheme, toast, notify, siteRoot, setSiteRoot }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
