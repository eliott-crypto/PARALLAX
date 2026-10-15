import { loadEnvironment } from './environment';
loadEnvironment();
import { createApp } from './app';
const { app, shutdown } = createApp();
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () =>
  console.log(
    `PARALLAX research server: http://${host}:${port} | Claude: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'add ANTHROPIC_API_KEY to .env'}`,
  ),
);
function stop() {
  shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
