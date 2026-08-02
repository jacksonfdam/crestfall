// Vercel Web Analytics. This is a plain Vite app (not Next.js), so we use
// inject() from the base package instead of the '@vercel/analytics/next'
// React component. No-ops outside a Vercel deployment.
import { inject } from '@vercel/analytics';

inject();
