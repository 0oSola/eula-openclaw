/// <reference types="vite/client" />

declare global {
  interface Window {
    desktopPet: {
      runtimeInfo: () => Promise<{ apiBaseUrl: string }>;
    };
  }
}

export {};
