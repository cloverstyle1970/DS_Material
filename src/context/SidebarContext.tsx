"use client";
import { createContext, useContext } from "react";

interface SidebarCtx {
  openSidebar: () => void;
}

const SidebarContext = createContext<SidebarCtx>({ openSidebar: () => {} });

export function useSidebar() {
  return useContext(SidebarContext);
}

export default SidebarContext;
