// Render.com start script
// This ensures proper startup in production

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Start the server
const server = spawn('node', [join(__dirname, 'dist', 'index.js')], {
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: 'inherit',
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  server.kill('SIGTERM');
});
