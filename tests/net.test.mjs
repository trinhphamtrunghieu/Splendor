/* Splendor — Vercel Server-Authoritative online play tests.
 *
 * Starts the real `/api/room` handler (`api/room.js`) on an in-process Node
 * HTTP server and exercises `SplendorNet` clients against it over real HTTP
 * POST + Long-Polling GET requests — zero external dependencies required.
 *
 *   node tests/net.test.mjs
 */
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
['data', 'engine', 'ai', 'net'].forEach((m) =>
  require('../assets/js/' + m + '.js'));
const roomApi = require('../api/room.js');

const E = globalThis.SplendorEngine;
const AI = globalThis.SplendorAI;
const Net = globalThis.SplendorNet;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  (' + detail + ')' : '')); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (fn, ms = 6000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  (function poll() {
    try {
      if (fn()) return resolve(true);
    } catch (err) { /* keep polling */ }
    if (Date.now() - t0 > ms) return reject(new Error('timeout'));
    setTimeout(poll, 20);
  })();
});

function startTestServer(port, managerOpts) {
  const manager = roomApi.createRoomManager(Object.assign({
    offlineTimeout: 450,
    waitTimeout: 120
  }, managerOpts || {}));
  const handler = roomApi.createHttpHandler(manager);
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/room')) return handler(req, res);
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: 'http://127.0.0.1:' + port + '/api/room',
        manager,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}

/* =========================================================================
   1. Server-Authoritative Room Protocol: Host, Guests, Redaction & Full Game
   ========================================================================= */
{
  console.log('\nServer-Authoritative room protocol: lobby, redaction, AI & full game\n');
  const srv = await startTestServer(9411);
  const API = srv.url;

  const hostBox = { net: Net.create({ clientId: 'host-1', apiUrl: API, waitMs: 100 }), view: null, seat: -1, views: 0 };
  hostBox.net.on('view', (v) => { hostBox.view = v.state; hostBox.seat = v.seat; hostBox.views++; });
  hostBox.net.host({ name: 'Hieu', room: 'ABC23' });
  await until(() => hostBox.net.connected && hostBox.net.joined);
  check('host creates a room on the Vercel API', hostBox.net.room === 'ABC23');

  function makeGuest(id, name) {
    const g = Net.create({ clientId: id, apiUrl: API, waitMs: 100, retryMs: 80 });
    const box = { net: g, view: null, room: null, seat: -1, views: 0, errors: [] };
    g.on('room', (r) => { box.room = r; });
    g.on('view', (v) => { box.view = v.state; box.seat = v.seat; box.views++; });
    g.on('actionError', (e) => { box.errors.push(e.error); });
    g.join({ room: 'ABC23', name });
    return box;
  }

  const lan = makeGuest('guest-lan', 'Lan');
  const nam = makeGuest('guest-nam', 'Nam');
  await until(() => hostBox.net.seats.length === 3);
  check('two guests are seated by the server',
    hostBox.net.seats.map(s => s.name).join(',') === 'Hieu,Lan,Nam');
  await until(() => lan.room && lan.room.seats.length === 3);
  check('guests receive the room roster via long-polling', lan.room.seats[2].name === 'Nam');

  hostBox.net.addBot('May 1', 'hard');
  await until(() => lan.room.seats.length === 4);
  check('the host can add an AI bot seat', lan.room.seats[3].type === 'ai');

  /* Start the game on the server */
  hostBox.net.startGame({ seed: 4242 });
  await until(() => hostBox.view && lan.view && nam.view);
  check('all human seats (host + guests) receive their game view from the server',
    hostBox.seat === 0 && lan.seat === 1 && nam.seat === 2);

  /* Hidden information: even the host only gets a redacted view from the server! */
  const serverRoom = await srv.manager.loadRoom('ABC23');
  check('the server holds the true unredacted deck',
    serverRoom.state.decks[1].every(c => c && c.id));
  check('neither host nor guest can read the deck order from their view',
    hostBox.view.decks[1].every(c => c === null) && lan.view.decks[1].every(c => c === null));

  /* Seat 0 (Hieu) reserves a card from tier 3 deck so it is secret */
  hostBox.net.sendIntent({ type: 'reserveDeck', tier: 3 });
  await until(() => hostBox.view.current === 1 && lan.view.current === 1);
  check('host sees their own reserved card in full',
    hostBox.view.players[0].reserved.length === 1 && !!hostBox.view.players[0].reserved[0].cost);
  check("guests cannot read the host's reserved card",
    lan.view.players[0].reserved.length === 1 &&
    lan.view.players[0].reserved[0].hidden === true &&
    !lan.view.players[0].reserved[0].cost);

  /* Seat 1 (Lan) plays a turn */
  const beforeLanViews = lan.views;
  lan.net.sendIntent({ type: 'take', colors: ['red', 'black', 'green'] });
  await until(() => lan.views > beforeLanViews && nam.view.current === 2);
  check("a guest's move is validated and broadcast by the server",
    lan.view.players[1].tokens.red === 1 && hostBox.view.players[1].tokens.red === 1);

  /* Out-of-turn move is refused by the server referee */
  const tokensBefore = JSON.stringify(serverRoom.state.players[1].tokens);
  lan.net.sendIntent({ type: 'take', colors: ['white', 'blue', 'red'] });
  await until(() => lan.errors.includes('err.notNow'));
  check('an out-of-turn move is refused by the server',
    JSON.stringify(serverRoom.state.players[1].tokens) === tokensBefore);

  /* Illegal move is refused by the server referee */
  const bankBefore = JSON.stringify(serverRoom.state.tokens);
  nam.net.sendIntent({ type: 'take', colors: ['white', 'white', 'white'] });
  await until(() => nam.errors.includes('err.mixInvalid'));
  check('an illegal move is refused by the server referee',
    JSON.stringify(serverRoom.state.tokens) === bankBefore);

  /* Seat 2 (Nam) makes a legal move -> Seat 3 is AI (May 1), so server automatically runs AI's turn! */
  nam.net.sendIntent({ type: 'take', colors: ['white', 'blue', 'green'] });
  await until(() => hostBox.view.current === 0 && hostBox.view.round === 2);
  check('the server automatically executes AI bot turns without client intervention',
    hostBox.view.round === 2 && hostBox.view.current === 0);

  /* Play the rest of the 4-seat game to completion through the server */
  const clientsBySeat = [hostBox, lan, nam];
  let guard = 0;
  while (serverRoom.state.phase !== 'gameover' && guard++ < 600) {
    const seat = serverRoom.state.current;
    const player = serverRoom.state.players[seat];
    const actor = clientsBySeat[seat];
    if (!actor) break;

    let action;
    if (serverRoom.state.phase === 'noble') {
      action = { type: 'noble', nobleId: serverRoom.state.pendingNobles[0] };
    } else if (serverRoom.state.phase === 'discard') {
      const give = {};
      let over = E.countTokens(player.tokens) - 10;
      for (const c of ['white', 'blue', 'green', 'red', 'black', 'gold']) {
        while (over > 0 && (player.tokens[c] || 0) > (give[c] || 0)) {
          give[c] = (give[c] || 0) + 1;
          over--;
        }
      }
      action = { type: 'discard', pile: give };
    } else {
      action = AI.chooseAction(serverRoom.state, AI.PROFILES.normal);
    }
    const prevTurnCount = serverRoom.state.turnCount;
    const prevPhase = serverRoom.state.phase;
    actor.net.sendIntent(action);
    await until(() =>
      serverRoom.state.phase === 'gameover' ||
      serverRoom.state.turnCount !== prevTurnCount ||
      serverRoom.state.phase !== prevPhase);
  }

  check('a 4-seat online game (3 humans + 1 bot) plays to completion on the server',
    serverRoom.state.phase === 'gameover', 'phase ' + serverRoom.state.phase + ' after ' + guard + ' steps');
  await until(() => lan.view.phase === 'gameover' && hostBox.view.phase === 'gameover');
  check('all players receive the final game-over state and winner',
    lan.view.winner === serverRoom.state.winner);

  /* Rematch in the same room */
  hostBox.net.rematch({ seed: 777 });
  await until(() => lan.view.phase === 'play' && lan.view.round === 1 && lan.view.turnCount === 0);
  check('the host can start a rematch in the same room for everyone',
    hostBox.view.phase === 'play' && lan.view.phase === 'play');

  [hostBox, lan, nam].forEach(b => b.net.leave());
  await srv.close();
}

/* =========================================================================
   2. Host Failover, Keeping New Host, Mid-Game Bot Takeover & Reconnection
   ========================================================================= */
{
  console.log('\nHost failover, preserving new host & mid-game bot takeover\n');
  const srv = await startTestServer(9412, { offlineTimeout: 350, waitTimeout: 80 });
  const API = srv.url;

  const hieu = Net.create({ clientId: 'u-hieu', apiUrl: API, waitMs: 80, retryMs: 60 });
  const lan = Net.create({ clientId: 'u-lan', apiUrl: API, waitMs: 80, retryMs: 60 });
  const nam = Net.create({ clientId: 'u-nam', apiUrl: API, waitMs: 80, retryMs: 60 });

  let hieuView = null, lanView = null, namView = null;
  let hostChanges = [];
  hieu.on('view', (v) => { hieuView = v.state; });
  lan.on('view', (v) => { lanView = v.state; });
  nam.on('view', (v) => { namView = v.state; });
  lan.on('hostChanged', (info) => hostChanges.push(info));

  hieu.host({ room: 'FA234', name: 'Hieu' });
  await until(() => hieu.connected && hieu.joined);
  lan.join({ room: 'FA234', name: 'Lan' });
  nam.join({ room: 'FA234', name: 'Nam' });
  await until(() => hieu.seats.length === 3 && lan.seats.length === 3 && nam.seats.length === 3);

  /* Start the game with 3 human players */
  hieu.startGame({ seed: 101 });
  await until(() => hieuView && lanView && namView);
  check('game starts with Hieu (seat 0) as initial host',
    lan.hostId === 'u-hieu' && lan.role === 'guest' && hieu.role === 'host');

  /* Hieu (seat 0) plays turn 1, then abruptly loses connection! */
  hieu.sendIntent({ type: 'take', colors: ['white', 'blue', 'green'] });
  await until(() => lanView.current === 1);
  hieu.disconnect();

  /* Wait for Lan and Nam to be notified that Hieu dropped and Lan is the new host */
  await until(() => lan.hostId === 'u-lan' && lan.role === 'host', 3000);
  check('when the initial host disconnects, host privileges transfer to the next online player (Lan)',
    lan.isHost() && nam.hostId === 'u-lan' && hostChanges.length >= 1);

  /* While Hieu is disconnected, Lan (seat 1) and Nam (seat 2) keep playing without interruption! */
  lan.sendIntent({ type: 'take', colors: ['red', 'black', 'green'] });
  await until(() => namView.current === 2);
  nam.sendIntent({ type: 'take', colors: ['white', 'red', 'blue'] });
  await until(() => lanView.current === 0);
  check('other players continue playing their turns normally even while the original host is offline',
    lanView.current === 0);

  /* Now it is Seat 0's turn (Hieu), who is still offline.
     The new host (Lan) clicks "Let bot play" (`botTakeover`) for Seat 0! */
  check('seat 0 is marked offline in the room roster', lan.seats[0].online === false);
  lan.botTakeover(0);
  await until(() => lanView.current === 1 && lanView.round === 2);
  check('new host can trigger botTakeover so a bot plays for the disconnected player',
    lan.seats[0].botTakeover === true && lanView.current === 1);

  /* Now Hieu reconnects!
     1) Hieu reclaims seat 0 (`botTakeover` becomes false, `type` becomes 'human' again).
     2) Lan REMAINS the host (`hostId === 'u-lan'`) as required! */
  hieu.reconnect();
  await until(() => hieu.connected && hieu.joined && lan.seats[0].online === true);
  check('when the old host reconnects, the new host (Lan) keeps host privileges',
    lan.hostId === 'u-lan' && hieu.hostId === 'u-lan' && lan.role === 'host' && hieu.role === 'guest');
  check('the returning player automatically reclaims control of their seat from the temporary bot',
    lan.seats[0].botTakeover === false && lan.seats[0].type === 'human');

  [hieu, lan, nam].forEach(c => c.leave());
  await srv.close();
}

/* =========================================================================
   3. Dual-Mode Storage: Write-on-Move to Upstash Redis & Cold-Start Restore
   ========================================================================= */
{
  console.log('\nDual-mode storage: Write-on-Move Redis backup & zero-read polling\n');
  const kvCalls = { get: 0, set: 0, del: 0, store: new Map() };
  const mockKv = {
    get: async (code) => {
      kvCalls.get++;
      const raw = kvCalls.store.get(code);
      return raw ? JSON.parse(raw) : null;
    },
    set: async (code, room) => {
      kvCalls.set++;
      kvCalls.store.set(code, JSON.stringify(room));
    },
    del: async (code) => {
      kvCalls.del++;
      kvCalls.store.delete(code);
    }
  };

  const srv1 = await startTestServer(9413, { kv: mockKv, waitTimeout: 60 });
  const a = Net.create({ clientId: 'kv-a', apiUrl: srv1.url, waitMs: 60 });
  const b = Net.create({ clientId: 'kv-b', apiUrl: srv1.url, waitMs: 60 });

  a.host({ room: 'KV234', name: 'Alice' });
  await until(() => a.joined);
  b.join({ room: 'KV234', name: 'Bob' });
  await until(() => a.seats.length === 2 && b.joined);

  const setsAfterJoin = kvCalls.set;
  const getsBeforePoll = kvCalls.get;
  /* Let several long-poll cycles run while idle */
  await wait(300);
  check('idle long-polling reads from RAM and issues 0 Redis GET or SET commands',
    kvCalls.get === getsBeforePoll && kvCalls.set === setsAfterJoin);

  /* Start game and make a move -> writes to Redis */
  a.startGame({ seed: 55 });
  await until(() => a.phase === 'playing');
  check('starting a game writes the updated state to Redis', kvCalls.set > setsAfterJoin);

  /* Simulate a Vercel serverless cold start by wiping the in-memory Map! */
  srv1.manager.rooms.clear();
  let bView = null;
  b.on('view', (v) => { bView = v.state; });
  a.sendIntent({ type: 'take', colors: ['white', 'blue', 'green'] });
  await until(() => bView && bView.current === 1);
  check('after a serverless cold start (RAM wiped), the room is transparently restored from Redis on the next move',
    kvCalls.get >= 1 && bView.players[0].tokens.white === 1);

  /* When all humans leave, the room is deleted from Redis too */
  a.leave();
  b.leave();
  await until(() => kvCalls.del >= 1);
  check('closing/leaving a room deletes its key from Redis', !kvCalls.store.has('KV234'));

  await srv1.close();
}

/* =========================================================================
   4. Renaming in the Lobby & Table Talk (Chat)
   ========================================================================= */
{
  console.log('\nRenaming in the lobby & room chat\n');
  const srv = await startTestServer(9414, { waitTimeout: 80 });
  const API = srv.url;

  const host = Net.create({ clientId: 'rn-host', apiUrl: API, waitMs: 80 });
  host.host({ room: 'RENAM', name: 'Hieu' });
  await until(() => host.connected && host.joined);

  const guest = Net.create({ clientId: 'rn-guest', apiUrl: API, waitMs: 80 });
  guest.join({ room: 'RENAM', name: 'Bạn' });
  await until(() => guest.status().seats.length === 2 && host.seats.length === 2);
  check('the guest arrives under the name it typed', guest.status().seats[1].name === 'Bạn');

  const renames = [];
  host.on('renamed', (info) => renames.push(info));
  guest.rename('Lan');
  await until(() => host.seats[1].name === 'Lan' && guest.seats[1].name === 'Lan');
  check('a guest renaming itself updates the server roster for everyone', true);
  check('rename event reports old and new name',
    renames.length === 1 && renames[0].from === 'Bạn' && renames[0].to === 'Lan');

  host.rename('  Tên\n\tdài   quá  đi   mất   thật   đấy  ');
  await until(() => host.seats[0].name.indexOf('Tên') === 0);
  const long = host.seats[0].name;
  check('a name is trimmed, flattened and cut to length',
    long.length <= Net.MAX_NAME && !/[\n\t]/.test(long) && !/  /.test(long));

  /* Chat ordering, attribution, escaping, and rate limiting */
  const heard = [];
  guest.on('chat', (line) => heard.push(line));
  host.sendChat('Chào cả nhà');
  await until(() => heard.length === 1 && host.chat.length === 1);
  check('a chat line from the host reaches the guest', heard[0].text === 'Chào cả nhà');
  check('the speaker sees its own line marked mine=true', host.chat[0].mine === true && heard[0].mine === false);

  await wait(400);
  guest.sendChat('Chào bạn');
  await until(() => host.chat.length === 2 && guest.chat.length === 2);
  check('both sides agree on the server chat order',
    host.chat.map(l => l.text).join('|') === guest.chat.map(l => l.text).join('|'));

  await wait(400);
  const first = guest.sendChat('một');
  const second = guest.sendChat('hai');
  check('a second chat line in the same instant is rate-limited', first !== null && second === null);

  /* Once the game starts, renaming is locked */
  host.startGame({ seed: 12 });
  await until(() => guest.status().phase === 'playing');
  check('renaming is closed once the cards are dealt', host.canRename() === false && guest.rename('Khác') === null);

  host.leave();
  guest.leave();
  await srv.close();
}

/* =========================================================================
   5. Error Handling & Recovery
   ========================================================================= */
{
  console.log('\nError handling: missing room, late host recovery & unreachable server\n');
  const srv = await startTestServer(9415, { waitTimeout: 80 });
  const API = srv.url;

  const lost = Net.create({ clientId: 'lost-1', apiUrl: API, roomTimeout: 350, retryMs: 80, waitMs: 80 });
  lost.join({ room: 'NR234', name: 'Lan' });
  await until(() => lost.status().error === 'room-not-found', 3000);
  check('a room nobody has created is reported as room-not-found', lost.status().joined === false);

  /* When the host creates the room later, the waiting guest joins automatically */
  const late = Net.create({ clientId: 'late-host', apiUrl: API, waitMs: 80 });
  late.host({ room: 'NR234', name: 'Hieu' });
  await until(() => lost.status().joined === true && !lost.status().error, 3000);
  check('when the host creates the room later, the waiting guest recovers on its own',
    lost.seats.length === 2);

  /* Unreachable server reports server-unreachable */
  const nowhere = Net.create({
    clientId: 'nowhere-1',
    apiUrl: 'http://127.0.0.1:9499/api/room',
    connectTimeout: 350,
    retryMs: 100
  });
  nowhere.join({ room: 'ABC23', name: 'Nam' });
  await until(() => nowhere.status().error === 'server-unreachable', 3000);
  check('an unreachable server is reported as server-unreachable', nowhere.status().connected === false);

  nowhere.leave();
  lost.leave();
  late.leave();
  await srv.close();
}

/* =========================================================================
   6. Turn Timer (Set by Host in Integer Minutes, Forfeits Turn on Expiry)
   ========================================================================= */
{
  console.log('\nTurn Timer: integer minutes configuration & automatic turn forfeiture on timeout\n');
  let clock = 500000;
  const srv = await startTestServer(9416, {
    waitTimeout: 60,
    now: () => clock
  });
  const API = srv.url;

  const host = Net.create({ clientId: 't-host', apiUrl: API, waitMs: 60 });
  const guest = Net.create({ clientId: 't-guest', apiUrl: API, waitMs: 60 });

  let hostView = null;
  let guestView = null;
  const timeouts = [];
  host.on('view', (v) => { hostView = v.state; });
  guest.on('view', (v) => { guestView = v.state; });
  host.on('turnTimeout', (info) => { timeouts.push(info); });

  host.host({ room: 'TM234', name: 'Chủ Phòng', turnTimer: 3 });
  await until(() => host.status().joined);
  check('host sets turnTimer in integer minutes (3 min) when creating room',
    host.status().turnTimer === 3);

  guest.join({ room: 'TM234', name: 'Khách' });
  await until(() => guest.status().joined && host.seats.length === 2);
  check('guest receives the room turnTimer (3 min) in lobby',
    guest.status().turnTimer === 3);

  host.startGame({ seed: 77 });
  await until(() => hostView && guestView);
  check('game state carries turnTimer=3 and turnLimitMs=180000',
    hostView.turnTimer === 3 && hostView.turnLimitMs === 180000);
  check('turn 0 starts at seat 0 with turnRemainingMs = 180000',
    hostView.current === 0 && hostView.turnRemainingMs === 180000);

  /* Advance clock past the 3-minute thinking limit without seat 0 making a move */
  clock += 180500;
  host.checkTimeout();
  await until(() => hostView.current === 1 && guestView.current === 1);

  check('when timer expires, seat 0 forfeits its turn and turn passes to seat 1',
    hostView.current === 1 && guestView.current === 1);
  check('timeout log entry is recorded in game log',
    hostView.log[hostView.log.length - 1].key === 'timeout' &&
    hostView.log[hostView.log.length - 1].params.p === 'Chủ Phòng');
  check('turnTimeout event fires with the timed-out player info',
    timeouts.length === 1 && timeouts[0].seat === 0 && timeouts[0].name === 'Chủ Phòng');
  check('seat 1 receives a fresh 3-minute timer for their turn',
    guestView.turnDeadline === clock + 180000);

  host.leave();
  guest.leave();
  await srv.close();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
