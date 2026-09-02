interface ImportMetaEnv {
  readonly VITE_WATCH_API_BASE?: string;
  readonly VITE_P2P_ROOMS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
