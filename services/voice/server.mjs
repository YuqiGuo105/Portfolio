import { createServer } from 'node:http';
import { createVoiceRelay } from './relay.mjs';
import { createModelGateway } from './modelGateway.mjs';

const relay = createVoiceRelay();
const modelGateway = createModelGateway();
const server = createServer(async (req, res) => {
  if (!(await modelGateway(req, res))) await relay.http(req, res);
});
server.on('upgrade', relay.upgrade);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
process.once('SIGTERM', () => {
  Promise.allSettled([relay.close(), new Promise(resolve => server.close(resolve))]).then(() => process.exit(0));
});
