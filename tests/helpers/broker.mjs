/* Local MQTT broker over WebSocket, for tests. */
import { Aedes } from 'aedes';
import http from 'node:http';
import { WebSocketServer, createWebSocketStream } from 'ws';

export async function startBroker(port) {
  const broker = await Aedes.createBroker();
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket) => {
    broker.handle(createWebSocketStream(socket));
  });
  await new Promise((resolve) => server.listen(port, resolve));
  return {
    broker,
    /* aedes keeps its own heartbeat interval, so closing only the http and
       websocket servers leaves the event loop alive and a finished test
       hanging instead of exiting. */
    close: () => new Promise((done) => {
      wss.close();
      server.close(() => broker.close(() => done()));
    })
  };
}
