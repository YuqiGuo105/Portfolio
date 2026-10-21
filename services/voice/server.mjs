import { createServer } from 'node:http';
import { createVoiceRelay } from './relay.mjs';

const relay = createVoiceRelay();
const server = createServer(relay.http);
server.on('upgrade', relay.upgrade);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
process.on('SIGTERM', () => { relay.close(); server.close(() => process.exit(0)); });
