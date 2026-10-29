declare const __APP_BUILD__: { version: string; commit: string; branch: string; builtAt: string; dirty?: boolean;
  exportEngine?: { core: string; wrapper: string; mode: string; maxHeapBytes?: number } };

declare module '*?url&no-inline' { const url: string; export default url; }
