/* Splendor — online play tests.
 *
 * These run the real MQTT client and the real room protocol against a real
 * broker (aedes, started in-process on a random port), so the wire format, the
 * retained-message handling and the referee rules are all exercised for real
 * rather than mocked.
 *
 *   npm install          # aedes + ws, dev only: the game itself ships no deps
 *   npm run test:net
 *
 * tests/engine.test.js covers everything that needs no network.
 */
import { startBroker } from './helpers/broker.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
['data', 'engine', 'ai', 'mqtt-lite', 'net'].forEach((m) =>
  require('../assets/js/' + m + '.js'));
const E = globalThis.SplendorEngine;
const AI = globalThis.SplendorAI;
const M = globalThis.MqttLite;
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
    if (fn()) return resolve(true);
    if (Date.now() - t0 > ms) return reject(new Error('timeout'));
    setTimeout(poll, 25);
  })();
});

{
  console.log('\nMQTT client over a real broker\n');
  const PORT = 9401;
  const URL = 'ws://127.0.0.1:' + PORT;
  const { broker, close } = await startBroker(PORT);

  const a = M.connect(URL, { clientId: 'alice' });
  const b = M.connect(URL, { clientId: 'bob' });
  const got = [];
  const wills = [];
  b.on('message', (topic, payload) => {
    if (topic.includes('/gone/')) wills.push(payload); else got.push({ topic, payload });
  });
  await until(() => a.connected && b.connected);
  check('two clients connect to a real broker', true);

  b.subscribe('splendor/v1/ROOM/state');
  b.subscribe('splendor/v1/ROOM/presence/+');
  b.subscribe('splendor/v1/ROOM/gone/+');
  await wait(150);

  a.publish('splendor/v1/ROOM/state', JSON.stringify({ seq: 1 }));
  await until(() => got.length === 1);
  check('publish reaches a subscriber', JSON.parse(got[0].payload).seq === 1);

  a.publish('splendor/v1/ROOM/presence/alice', 'here');
  await until(() => got.length === 2);
  check('wildcard subscription delivers', got[1].topic.endsWith('/presence/alice'));

  a.publish('splendor/v1/ROOM/room', JSON.stringify({ phase: 'lobby' }), { retain: true });
  await wait(150);
  const late = M.connect(URL, { clientId: 'carol' });
  const lateGot = [];
  late.on('message', (t, p) => lateGot.push({ topic: t, payload: p }));
  await until(() => late.connected);
  late.subscribe('splendor/v1/ROOM/room');
  await until(() => lateGot.length === 1);
  check('a late joiner is handed the retained room state', JSON.parse(lateGot[0].payload).phase === 'lobby');

  const bigState = { decks: {} };
  for (let i = 0; i < 90; i++) bigState.decks['c' + i] = { id: 't' + i, cost: { white: 3, blue: 2 }, pad: 'x'.repeat(90) };
  const bigJson = JSON.stringify(bigState);
  a.publish('splendor/v1/ROOM/state', bigJson);
  await until(() => got.length === 3);
  check(Math.round(bigJson.length / 1024) + ' KB state survives frame reassembly',
    got[2].payload === bigJson, 'got ' + got[2].payload.length + ' of ' + bigJson.length + ' bytes');

  a.publish('splendor/v1/ROOM/state', JSON.stringify({ name: 'Hiếu — 💎 Lượt của bạn' }));
  await until(() => got.length === 4);
  check('utf-8 names survive the wire', JSON.parse(got[3].payload).name.indexOf('Hiếu') === 0);

  for (let i = 0; i < 20; i++) a.publish('splendor/v1/ROOM/state', JSON.stringify({ n: i }));
  await until(() => got.length === 24);
  check('20 rapid publishes arrive, in order',
    got.slice(4).every((m, i) => JSON.parse(m.payload).n === i));

  const polite = M.connect(URL, {
    clientId: 'dave',
    will: { topic: 'splendor/v1/ROOM/gone/dave', payload: 'bye' }
  });
  await until(() => polite.connected);
  polite.end();
  await wait(400);
  check('a clean disconnect sends no will', wills.length === 0, 'got ' + wills.length);

  const dropped = M.connect(URL, {
    clientId: 'erin',
    reconnect: false,
    will: { topic: 'splendor/v1/ROOM/gone/erin', payload: 'bye' }
  });
  await until(() => dropped.connected);
  await wait(150);
  broker.clients['erin'].conn.destroy();
  await until(() => wills.length === 1, 4000).catch(() => {});
  check('an abrupt drop triggers the last will', wills.length === 1, 'got ' + wills.length);

  const flappy = M.connect(URL, { clientId: 'frank' });
  const flappyGot = [];
  flappy.on('message', (t, p) => flappyGot.push(p));
  await until(() => flappy.connected);
  flappy.subscribe('splendor/v1/ROOM/state');
  await wait(150);
  let reconnects = 0;
  flappy.on('connect', () => reconnects++);
  broker.clients['frank'].conn.destroy();
  await until(() => flappy.connected && reconnects >= 1, 8000);
  await wait(250);
  a.publish('splendor/v1/ROOM/state', JSON.stringify({ afterReconnect: true }));
  await until(() => flappyGot.some(p => JSON.parse(p).afterReconnect), 4000);
  check('a dropped client reconnects and re-subscribes on its own', true);

  [a, b, late, dropped, flappy].forEach((c) => c.end());
  await close();
}

{
  console.log('\nRoom protocol: host, guests and the referee\n');
  const PORT = 9402;
  const URL = 'ws://127.0.0.1:' + PORT;
  const room = await startBroker(PORT);
  const broker = room.broker;

  /* ---------------- host ---------------- */
  const host = Net.create({ clientId: 'host-1' });
  let hostState = null;
  host.on('intent', (msg) => {
    const seat = host.seatOf(msg.id);
    if (seat < 0 || !hostState || seat !== hostState.current) return;
    const result = E.applyAction(hostState, msg.action);
    if (result.ok) host.broadcast(hostState);
    else host.broadcast(hostState);       // refused: re-sync the sender
  });
  host.host({ name: 'Hieu', brokerUrl: URL, room: 'ABC23' });
  await until(() => host.connected);
  check('host opens a room', host.room === 'ABC23');

  /* ---------------- guests ---------------- */
  function makeGuest(id, name) {
    const g = Net.create({ clientId: id });
    const box = { net: g, view: null, room: null, seat: -1, views: 0 };
    g.on('room', (r) => { box.room = r; });
    g.on('view', (v) => { box.view = v.state; box.seat = v.seat; box.views++; });
    g.join({ room: 'ABC23', name, brokerUrl: URL });
    return box;
  }
  const lan = makeGuest('guest-lan', 'Lan');
  const nam = makeGuest('guest-nam', 'Nam');
  await until(() => host.seats.length === 3, 6000);
  check('two guests are seated by the host', host.seats.map(s => s.name).join(',') === 'Hieu,Lan,Nam');
  await until(() => lan.room && lan.room.seats.length === 3);
  check('guests see the roster', lan.room.seats[2].name === 'Nam');

  host.addBot('May 1', 'hard');
  await until(() => lan.room.seats.length === 4);
  check('the host can add a bot seat', lan.room.seats[3].type === 'ai');

  /* ---------------- start ---------------- */
  hostState = E.createGame({
    players: host.seats.map(s => ({ name: s.name, type: s.type, difficulty: s.difficulty })),
    seed: 4242
  });
  host.setState(hostState);
  host.broadcast(hostState);
  await until(() => lan.view && nam.view, 6000);
  check('both guests receive a game view', lan.seat === 1 && nam.seat === 2);

  /* ---------------- hidden information ---------------- */
  hostState.players[0].reserved.push(hostState.decks[3].pop());
  hostState.players[1].reserved.push(hostState.decks[3].pop());
  host.broadcast(hostState);
  await until(() => lan.view.players[1].reserved.length === 1);
  check('a guest sees its own reserved card in full', !!lan.view.players[1].reserved[0].cost);
  check("a guest cannot read another player's reserved card",
    lan.view.players[0].reserved[0].hidden === true && !lan.view.players[0].reserved[0].cost);
  check('deck order is not leaked, only the count',
    lan.view.decks[1].length === hostState.decks[1].length && lan.view.decks[1].every(c => c === null));
  check('public information is intact',
    JSON.stringify(lan.view.tokens) === JSON.stringify(hostState.tokens) &&
    lan.view.board[1].filter(Boolean).length === hostState.board[1].filter(Boolean).length);

  /* ---------------- a guest plays a turn ---------------- */
  await until(() => hostState.current === 0);
  // host takes gems itself first
  E.applyAction(hostState, { type: 'take', colors: ['white', 'blue', 'green'] });
  host.broadcast(hostState);
  await until(() => lan.view.current === 1 && lan.view.players[0].tokens.white === 1);
  check("the host's own move reaches the guests", true);

  const beforeSeq = lan.views;
  lan.net.sendIntent({ type: 'take', colors: ['red', 'black', 'green'] });
  await until(() => hostState.players[1].tokens.red === 1, 6000);
  check("a guest's intent is applied by the host", hostState.current === 2);
  await until(() => lan.views > beforeSeq);
  check('the guest is sent the result', lan.view.players[1].tokens.red === 1);

  /* ---------------- out-of-turn moves are refused ---------------- */
  const tokensBefore = JSON.stringify(hostState.players[1].tokens);
  lan.net.sendIntent({ type: 'take', colors: ['white', 'blue', 'red'] });   // not Lan's turn
  await wait(400);
  check('a move out of turn changes nothing',
    JSON.stringify(hostState.players[1].tokens) === tokensBefore);

  /* ---------------- an illegal move is refused ---------------- */
  await until(() => hostState.current === 2);
  const bankBefore = JSON.stringify(hostState.tokens);
  nam.net.sendIntent({ type: 'take', colors: ['white', 'white', 'white'] });  // never legal
  await wait(400);
  check('an illegal move is refused by the referee', JSON.stringify(hostState.tokens) === bankBefore);

  /* ---------------- play the whole game out ---------------- */
  let guard = 0;
  while (hostState.phase !== 'gameover' && guard++ < 900) {
    const seat = hostState.current;
    const player = hostState.players[seat];
    if (hostState.phase === 'noble') {
      const action = { type: 'noble', nobleId: hostState.pendingNobles[0] };
      if (seat === 0 || player.type === 'ai') { E.applyAction(hostState, action); host.broadcast(hostState); }
      else { (seat === 1 ? lan : nam).net.sendIntent(action); await wait(30); }
      continue;
    }
    if (hostState.phase === 'discard') {
      const give = {};
      let over = E.countTokens(player.tokens) - 10;
      for (const c of ['white', 'blue', 'green', 'red', 'black', 'gold']) {
        while (over > 0 && (player.tokens[c] || 0) > (give[c] || 0)) { give[c] = (give[c] || 0) + 1; over--; }
      }
      const action = { type: 'discard', pile: give };
      if (seat === 0 || player.type === 'ai') { E.applyAction(hostState, action); host.broadcast(hostState); }
      else { (seat === 1 ? lan : nam).net.sendIntent(action); await wait(30); }
      continue;
    }
    const action = AI.chooseAction(hostState, AI.PROFILES.normal);
    if (seat === 0 || player.type === 'ai') {
      E.applyAction(hostState, action);
      host.broadcast(hostState);
    } else {
      (seat === 1 ? lan : nam).net.sendIntent(action);
      await wait(35);
    }
  }
  check('a four-seat online game plays to a finish over MQTT',
    hostState.phase === 'gameover', 'phase ' + hostState.phase + ' after ' + guard + ' steps');
  await until(() => lan.view.phase === 'gameover', 4000);
  check('guests are told the game ended', lan.view.winner === hostState.winner);

  /* ---------------- reconnect: the retained view restores a guest ---------------- */
  const rejoin = makeGuest('guest-lan', 'Lan');
  await until(() => rejoin.view, 6000);
  check('a returning player is handed their seat and view by the broker',
    rejoin.seat === 1 && !!rejoin.view && rejoin.view.players[1].reserved[0].cost);

  /* ---------------- a drop is noticed ---------------- */
  let leftSeat = -1;
  host.on('left', (info) => { leftSeat = info.seat; });
  broker.clients[Object.keys(broker.clients).find(k => k.startsWith('guest-nam'))].conn.destroy();
  await until(() => leftSeat === 2, 6000).catch(() => {});
  check('the host is told when a player drops', leftSeat === 2, 'leftSeat ' + leftSeat);

  /* ---------------- closing the room clears the broker ---------------- */
  host.leave();
  await wait(300);
  const fresh = Net.create({ clientId: 'watcher' });
  let sawRetained = false;
  fresh.on('room', () => { sawRetained = true; });
  fresh.join({ room: 'ABC23', name: 'watcher', brokerUrl: URL });
  await until(() => fresh.connected);
  await wait(600);
  check('a closed room leaves no retained state on the broker', !sawRetained);

  [lan, nam, rejoin].forEach(g => g.net.leave());
  fresh.leave();
  await room.close();
}

{
  console.log('\nWhen things go wrong\n');
  const PORT = 9403;
  const URL = 'ws://127.0.0.1:' + PORT;
  const room = await startBroker(PORT);

  /* A guest that names a room nobody is hosting must be told so, rather than
     being left in a lobby claiming it is waiting for the host to start. */
  const lost = Net.create({ clientId: 'lost-1', roomTimeout: 700 });
  const seen = [];
  lost.on('status', (st) => seen.push(st));
  lost.join({ room: 'NOROOM', name: 'Lan', brokerUrl: URL });
  await until(() => lost.connected);
  check('connecting to a broker does not by itself mean being in a room',
    lost.status().joined === false);
  await until(() => lost.status().error === 'room-not-found', 4000);
  check('a room nobody hosts is reported as not found', true);

  /* And if a host turns up later, the error clears by itself. */
  const late = Net.create({ clientId: 'late-host' });
  late.host({ room: 'NOROOM', name: 'Hieu', brokerUrl: URL });
  await until(() => late.connected);
  await until(() => lost.status().joined === true && !lost.status().error, 5000);
  check('when the host finally appears, the guest recovers on its own', true);

  /* A broker that cannot be reached must not be reported as "connecting" for
     ever: that is indistinguishable from a hung page. */
  const nowhere = Net.create({ clientId: 'nowhere-1', connectTimeout: 600 });
  nowhere.join({ room: 'ABC23', name: 'Nam', brokerUrl: 'ws://127.0.0.1:9499' });
  await until(() => nowhere.status().error === 'broker-unreachable', 5000);
  check('an unreachable broker is reported as unreachable',
    nowhere.status().connected === false);
  nowhere.leave();

  /* The host's browser is the referee, so its disappearance has to reach the
     other players. The broker does it for us with the host's last will. */
  const host = Net.create({ clientId: 'host-2' });
  host.host({ room: 'WILLX', name: 'Hieu', brokerUrl: URL });
  await until(() => host.connected);
  const guest = Net.create({ clientId: 'guest-2' });
  let announced = 0;
  guest.on('hostgone', () => announced++);
  guest.join({ room: 'WILLX', name: 'Lan', brokerUrl: URL });
  await until(() => guest.status().joined === true, 5000);
  check('the guest is seated in the hosted room', guest.status().seats.length === 2);

  const hostKey = Object.keys(room.broker.clients).find((k) => k.startsWith('host-2'));
  room.broker.clients[hostKey].conn.destroy();
  await until(() => announced > 0, 6000).catch(() => {});
  check('a host that vanishes is announced to the guests', announced > 0,
    'announcements: ' + announced);
  check('the guest records that the host is gone', guest.status().hostGone === true);

  /* A host who merely blipped comes back and publishes the room again, which
     must clear the warning rather than leaving the game looking dead. */
  const returning = Net.create({ clientId: 'host-2' });
  returning.host({ room: 'WILLX', name: 'Hieu', brokerUrl: URL });
  await until(() => returning.connected);
  returning.publishRoom();
  await until(() => guest.status().hostGone === false, 5000);
  check('a host coming back clears the warning', !guest.status().error);

  [lost, late, host, guest, returning].forEach((c) => c.leave());
  await room.close();
}

{
  console.log('\nRenaming in the lobby\n');
  const PORT = 9404;
  const URL = 'ws://127.0.0.1:' + PORT;
  const room = await startBroker(PORT);

  const host = Net.create({ clientId: 'rn-host' });
  host.host({ room: 'RENAM', name: 'Hieu', brokerUrl: URL });
  await until(() => host.connected);

  const guest = Net.create({ clientId: 'rn-guest' });
  guest.join({ room: 'RENAM', name: 'Bạn', brokerUrl: URL });
  await until(() => guest.status().seats.length === 2, 6000);
  check('the guest arrives under the name it typed',
    guest.status().seats[1].name === 'Bạn', guest.status().seats[1].name);

  /* A guest cannot edit the roster: it asks, and the host's copy is the one
     that travels back to everybody. */
  guest.rename('Lan');
  await until(() => guest.status().seats[1].name === 'Lan', 5000);
  check('a guest renaming itself reaches the host and comes back', true);
  check('and the host agrees about the new name', host.seats[1].name === 'Lan',
    host.seats[1].name);

  const renames = [];
  host.on('renamed', (info) => renames.push(info));
  guest.rename('Nam');
  await until(() => renames.length === 1, 5000);
  check('the host reports who changed what', renames[0].from === 'Lan' && renames[0].to === 'Nam',
    JSON.stringify(renames[0]));

  /* The host renames itself without asking anyone. */
  host.rename('Hiếu');
  await until(() => guest.status().seats[0].name === 'Hiếu', 5000);
  check('the host can rename itself too', true);

  /* Nothing dangerous or absurd gets into a name. */
  host.rename('  Tên\n\tdài   quá  đi   mất   thật   đấy  ');
  await wait(250);
  const long = host.seats[0].name;
  check('a name is trimmed, flattened and cut to length',
    long.length <= Net.MAX_NAME && !/[\n\t]/.test(long) && !/  /.test(long), JSON.stringify(long));

  const before = host.seats[0].name;
  host.rename('   ');
  host.rename('');
  host.rename(null);
  await wait(200);
  check('an empty name is refused rather than blanking the seat',
    host.seats[0].name === before, host.seats[0].name);

  /* A guest re-announces itself on every reconnect. If it announced the name
     it arrived with, a blip would quietly undo the rename. */
  const guestKey = Object.keys(room.broker.clients).find((k) => k.startsWith('rn-guest'));
  room.broker.clients[guestKey].conn.destroy();
  await until(() => guest.connected === false, 5000).catch(() => {});
  await until(() => guest.connected === true, 12000);
  await wait(500);
  check('a reconnect keeps the chosen name rather than the one it arrived with',
    host.seats[1].name === 'Nam', host.seats[1].name);

  /* The promise to the player is "until the round starts". */
  host.broadcast(E.createGame({ players: [{ name: 'A', type: 'human' }, { name: 'B', type: 'human' }] }));
  await until(() => guest.status().phase === 'playing', 5000);
  check('renaming is closed once the cards are dealt', host.canRename() === false);
  const locked = host.seats[0].name;
  check('the host refuses its own late rename', host.rename('Khác') === null);
  guest.rename('Khác');
  await wait(300);
  check('and ignores a guest asking late', host.seats[0].name === locked && host.seats[1].name !== 'Khác',
    host.seats.map((s) => s.name).join(','));

  [host, guest].forEach((c) => c.leave());
  await room.close();
}

{
  console.log('\nTable talk\n');
  const PORT = 9405;
  const URL = 'ws://127.0.0.1:' + PORT;
  const room = await startBroker(PORT);

  const host = Net.create({ clientId: 'ch-host' });
  host.host({ room: 'CHATX', name: 'Hieu', brokerUrl: URL });
  await until(() => host.connected);
  const guest = Net.create({ clientId: 'ch-guest' });
  guest.join({ room: 'CHATX', name: 'Lan', brokerUrl: URL });
  await until(() => guest.status().seats.length === 2, 6000);

  const heard = [];
  guest.on('chat', (line) => heard.push(line));

  host.sendChat('Chào cả nhà');
  await until(() => heard.length === 1, 5000);
  check('a line from the host reaches the guest', heard[0].text === 'Chào cả nhà', heard[0].text);
  check('it is attributed to the player who said it', heard[0].name === 'Hieu', heard[0].name);
  check('and the guest knows it was not its own', heard[0].mine === false);

  /* Everyone sees one order of messages, ours included: the broker is what
     decides, not each browser's optimism. */
  await until(() => host.chat.length === 1, 5000);
  check('the speaker sees its own line come back', host.chat[0].mine === true);

  await wait(400);
  guest.sendChat('Chào bạn');
  await until(() => host.chat.length === 2, 5000);
  check('a line from the guest reaches the host', host.chat[1].text === 'Chào bạn');
  check('the host can tell it apart from its own', host.chat[1].mine === false);
  check('both sides agree on the order',
    host.chat.map((l) => l.text).join('|') === guest.chat.map((l) => l.text).join('|'),
    host.chat.map((l) => l.text).join('|') + ' vs ' + guest.chat.map((l) => l.text).join('|'));

  /* Chat is not refereed, so it must keep working during a game too. */
  host.broadcast(E.createGame({ players: [{ name: 'Hieu', type: 'human' }, { name: 'Lan', type: 'human' }] }));
  await until(() => guest.status().phase === 'playing', 5000);
  await wait(400);
  guest.sendChat('Lượt của ai đấy');
  await until(() => host.chat.length === 3, 5000);
  check('the table can still talk after the game has started', host.chat[2].text === 'Lượt của ai đấy');

  /* Nothing a peer sends can wreck another table. */
  await wait(400);
  const huge = 'x'.repeat(5000);
  guest.sendChat(huge);
  await until(() => host.chat.length === 4, 5000);
  check('an overlong line is cut to size', host.chat[3].text.length === Net.MAX_CHAT,
    'length ' + host.chat[3].text.length);

  await wait(400);
  check('an empty line is not sent at all', guest.sendChat('   ') === null);
  check('nor is a line of newlines', guest.sendChat('\n\n\t') === null);

  /* A stuck key must not flood a shared public broker. */
  await wait(400);
  const first = guest.sendChat('một');
  const second = guest.sendChat('hai');
  check('a second line in the same instant is held back', first !== null && second === null);

  /* Notes about what happened go in the same stream, and are never sent. */
  await wait(500);                       // let the lines above finish arriving
  const before = guest.chat.length;
  const hostHeard = host.chat.length;
  guest.note('Lan đã vào phòng.');
  check('a note lands in the log as a note, not as something said',
    guest.chat.length === before + 1 && guest.chat[before].system === true);
  check('a note is not attributed to anyone', guest.chat[before].mine === undefined);
  await wait(300);
  check('and it never leaves this browser', host.chat.length === hostHeard,
    'host heard ' + host.chat.length + ', expected ' + hostHeard);
  check('an empty note is not recorded', guest.note('  ') === null);

  /* The log is bounded whatever fills it: a long game cannot grow it without
     limit, and notes must not slip past the cap either. */
  for (let i = 0; i < Net.CHAT_HISTORY + 40; i++) guest.note('nốt ' + i);
  check('the kept history is bounded', guest.chat.length === Net.CHAT_HISTORY,
    'kept ' + guest.chat.length);
  check('and it is the newest lines that are kept',
    guest.chat[guest.chat.length - 1].text === 'nốt ' + (Net.CHAT_HISTORY + 39),
    guest.chat[guest.chat.length - 1].text);

  /* Leaving a public broker should not leave the room's chatter on it. */
  check('there was something to forget', host.chat.length > 0);
  host.leave();
  check('leaving forgets what was said', host.chat.length === 0);

  guest.leave();
  await room.close();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
