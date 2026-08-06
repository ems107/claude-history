// Injected by esbuild at package time (scripts/package.mjs passes
// --define:__APP_VERSION__='"X.Y.Z"'). Under tsx (dev) the identifier is
// undefined, so the version reads 'dev' — the updater uses this to refuse
// applying updates to a non-installed instance.
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'dev';
