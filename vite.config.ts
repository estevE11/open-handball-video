import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

function buildBranch() {
  if (process.env.VERCEL_GIT_COMMIT_REF) return process.env.VERCEL_GIT_COMMIT_REF
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return '' }
}

const isDevBranch = buildBranch() === 'dev'
let buildCommit = process.env.VERCEL_GIT_COMMIT_SHA ?? ''
let buildDirty = false
try { buildDirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { /* Deployment builds may not include .git. */ }
if (!buildCommit) {
  try { buildCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { buildCommit = 'unknown' }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  define: { __APP_BUILD__: JSON.stringify({ version: JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version,
    commit: buildCommit, branch: buildBranch(), builtAt: new Date().toISOString(), dirty: buildDirty }) },
  build: { sourcemap: 'hidden' },
  plugins: [react(), {
    name: 'dev-branch-indicator',
    transformIndexHtml(html) {
      if (!isDevBranch) return html
      return {
        html: html.replace('<title>', '<title>[DEV] '),
        tags: [{ tag: 'div', attrs: { class: 'dev-corner', 'aria-hidden': 'true' }, injectTo: 'body' }],
      }
    },
  }],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    headers: {
      // Required for ffmpeg.wasm on some browsers/environments (SharedArrayBuffer).
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
