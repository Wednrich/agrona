import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
const Context = createContext<{
  user: User | null;
  demo: boolean;
  loading: boolean;
  enterDemo: () => void;
  logout: () => Promise<void>;
}>({
  user: null,
  demo: false,
  loading: true,
  enterDemo: () => {},
  logout: async () => {},
});
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [demo, setDemo] = useState(
    sessionStorage.getItem("field-shift-demo") === "true",
  );
  const [loading, setLoading] = useState(!!supabase);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (session) {
        setDemo(false);
        sessionStorage.removeItem("field-shift-demo");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return (
    <Context.Provider
      value={{
        user,
        demo,
        loading,
        enterDemo: () => {
          sessionStorage.setItem("field-shift-demo", "true");
          setDemo(true);
        },
        logout: async () => {
          if (supabase) {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
          }
          queryClient.clear();
          setUser(null);
          setDemo(false);
          sessionStorage.removeItem("field-shift-demo");
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
