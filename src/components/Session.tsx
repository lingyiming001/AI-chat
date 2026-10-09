"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
type User = {
  id: string;
  nickname: string;
  email: string;
  balance: number;
  role: "USER" | "ADMIN";
};
const Context = createContext<{
  user: User | null;
  demo: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}>({ user: null, demo: false, loading: true, refresh: async () => {} });
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth");
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        setDemo(data.demo);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh().catch(() => setLoading(false));
  }, [refresh]);
  return (
    <Context.Provider value={{ user, demo, loading, refresh }}>
      {children}
    </Context.Provider>
  );
}
export const useSession = () => useContext(Context);
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败，请重试");
  return data as T;
}
export type RoleCard = {
  id: string;
  name: string;
  title: string;
  avatarUrl: string | null;
  tags: string[];
  greeting: string;
  pricePerMessage: number;
  status: string;
};
export const fallbackAvatar =
  "https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=600&q=80";
