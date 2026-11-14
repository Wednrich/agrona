import { create } from "zustand";
export const useUI = create<{ farmId: string; setFarm: (id: string) => void }>(
  (set) => ({ farmId: "", setFarm: (farmId) => set({ farmId }) }),
);
