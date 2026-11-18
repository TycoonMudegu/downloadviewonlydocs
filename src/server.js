import { createApp } from './app.js';
import { readConfig } from './config.js';
import { convertDrivePdf } from './converter.js';

const config = readConfig();
const app = createApp({ config, convert: convertDrivePdf });
const server = app.listen(config.port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', port: config.port })));
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    app.locals.shutdown();
    server.close();
    setTimeout(() => server.closeAllConnections(), 8000).unref();
  });
}
