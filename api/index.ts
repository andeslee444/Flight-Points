import { initPool } from '../src/flights/db.js';
import { app } from '../src/flights/web-server.js';

// Initialize DB pool at module scope — Vercel reuses the module between warm invocations
initPool();

export default app;
