import { loadDevBoot } from '@/boot/start'

// Production receives these values from the server-rendered page. Vite serves
// index.html directly, so its session token must arrive before app imports run.
if (import.meta.env.DEV) await loadDevBoot()
await import('./main')
