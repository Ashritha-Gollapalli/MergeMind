const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const jwt = require("jsonwebtoken");
const Project = require("../src/models/Project");
const User = require("../src/models/User");
const {
  registerSocketHandlers,
  updateProjectMemberAccess,
} = require("../src/socket");

const projectId = "507f1f77bcf86cd799439011";
const otherProjectId = "507f1f77bcf86cd799439012";
const userId = "507f1f77bcf86cd799439013";
const secondUserId = "507f1f77bcf86cd799439014";
const tokenSecret = "audio-socket-test-secret";
const originalFindById = User.findById;
const originalProjectFindOne = Project.findOne;
const originalJwtSecret = process.env.JWT_SECRET;
const clients = [];
let io;

after(() => {
  User.findById = originalFindById;
  Project.findOne = originalProjectFindOne;
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
  for (const client of clients) io?.sockets.delete(client);
});

test("audio rooms enforce project membership and relay only to room participants", async () => {
  const invalidAuth = new FakeSocket(io, {});
  const missingTokenError = await authenticate(io, invalidAuth);
  assert.match(missingTokenError.message, /Authentication required/);

  const first = await createClient(io);
  const malformedJoin = await first.clientEmit("audio:join", null);
  assert.equal(malformedJoin.ok, false);

  const firstJoin = await first.clientEmit("audio:join", { projectId });
  assert.equal(firstJoin.ok, true);
  assert.deepEqual(firstJoin.participants, []);

  const unauthorized = await first.clientEmit("audio:join", {
    projectId: otherProjectId,
  });
  assert.equal(unauthorized.ok, false);
  assert.match(unauthorized.message, /do not have access/);

  const second = await createClient(io, secondUserId);
  const secondJoin = await second.clientEmit("audio:join", { projectId });
  assert.equal(secondJoin.ok, true);
  assert.equal(secondJoin.participants.length, 1);
  assert.equal(secondJoin.participants[0].socketId, first.id);

  const joinedEvent = await first.nextClientEvent("audio:participant-joined");
  assert.equal(joinedEvent.participant.socketId, second.id);

  const description = { type: "offer", sdp: "test-session-description" };
  const relay = await second.clientEmit("audio:offer", {
    projectId,
    to: first.id,
    description,
  });
  assert.equal(relay.ok, true);
  const offer = await first.nextClientEvent("audio:offer");
  assert.equal(offer.fromSocketId, second.id);
  assert.deepEqual(offer.description, description);

  const outsideRoom = await second.clientEmit("audio:offer", {
    projectId,
    to: "not-a-room-participant",
    description,
  });
  assert.equal(outsideRoom.ok, false);
  assert.match(outsideRoom.message, /not in this project room/);

  const state = await second.clientEmit("audio:state", {
    projectId,
    muted: false,
    speaking: true,
  });
  assert.equal(state.ok, true);
  const speakingEvent = await first.nextClientEvent("audio:participant-state");
  assert.equal(speakingEvent.socketId, second.id);
  assert.equal(speakingEvent.speaking, true);

  await second.trigger("disconnecting");
  io.removeClient(second);
  const leftEvent = await first.nextClientEvent("audio:participant-left");
  assert.equal(leftEvent.socketId, second.id);

  const reconnected = await createClient(io, secondUserId);
  const reconnectJoin = await reconnected.clientEmit("audio:join", { projectId });
  assert.equal(reconnectJoin.ok, true);
  assert.deepEqual(
    reconnectJoin.participants.map((participant) => participant.socketId),
    [first.id]
  );

  const leave = await reconnected.clientEmit("audio:leave", { projectId });
  assert.equal(leave.ok, true);
  const reconnectedLeft = await first.nextClientEvent("audio:participant-left");
  assert.equal(reconnectedLeft.socketId, reconnected.id);

  const revokedSocket = await createClient(io, secondUserId);
  const revokedJoin = await revokedSocket.clientEmit("audio:join", { projectId });
  assert.equal(revokedJoin.ok, true);
  await updateProjectMemberAccess(io, projectId, secondUserId, null);
  const revoked = await revokedSocket.nextClientEvent("project:access-revoked");
  assert.equal(revoked.projectId, projectId);
  const revokedLeft = await first.nextClientEvent("audio:participant-left");
  assert.equal(revokedLeft.socketId, revokedSocket.id);
  assert.equal(revokedSocket.rooms.has(`audio:${projectId}`), false);
  const afterRevocation = await revokedSocket.clientEmit("audio:state", {
    projectId,
    muted: false,
    speaking: false,
  });
  assert.equal(afterRevocation.ok, false);
});

function authenticate(server, socket) {
  return new Promise((resolve) => {
    server.middleware(socket, (error) => resolve(error || null));
  });
}

async function createClient(server, clientUserId = userId) {
  const token = jwt.sign({ sub: clientUserId }, tokenSecret);
  const socket = new FakeSocket(server, { token });
  const error = await authenticate(server, socket);
  assert.equal(error, null);
  server.sockets.add(socket);
  server.connectionHandler(socket);
  clients.push(socket);
  return socket;
}

class FakeIo {
  constructor() {
    this.sockets = new Set();
    this.middleware = null;
    this.connectionHandler = null;
  }

  use(handler) {
    this.middleware = handler;
  }

  on(eventName, handler) {
    if (eventName === "connection") this.connectionHandler = handler;
  }

  in(room) {
    return {
      fetchSockets: async () =>
        Array.from(this.sockets).filter((socket) => socket.rooms.has(room)),
    };
  }

  to(room) {
    return {
      emit: (eventName, payload) => this.emitToRoom(room, eventName, payload),
    };
  }

  emitToRoom(room, eventName, payload, excludedSocketId) {
    for (const socket of this.sockets) {
      if (
        socket.id !== excludedSocketId &&
        (socket.rooms.has(room) || socket.id === room)
      ) {
        socket.receive(eventName, payload);
      }
    }
  }

  removeClient(socket) {
    socket.rooms.clear();
    this.sockets.delete(socket);
  }
}

class FakeSocket {
  constructor(server, auth) {
    this.server = server;
    this.id = `socket-${Math.random().toString(16).slice(2)}`;
    this.handshake = { auth };
    this.rooms = new Set([this.id]);
    this.data = {};
    this.listeners = new Map();
    this.clientEvents = new Map();
    this.clientEventWaiters = new Map();
  }

  on(eventName, handler) {
    const handlers = this.listeners.get(eventName) || [];
    handlers.push(handler);
    this.listeners.set(eventName, handlers);
  }

  emit(eventName, payload) {
    this.receive(eventName, payload);
  }

  to(room) {
    return {
      emit: (eventName, payload) =>
        this.server.emitToRoom(room, eventName, payload, this.id),
    };
  }

  async join(room) {
    this.rooms.add(room);
  }

  async leave(room) {
    this.rooms.delete(room);
  }

  async trigger(eventName) {
    for (const handler of this.listeners.get(eventName) || []) {
      await handler();
    }
  }

  receive(eventName, payload) {
    const waiters = this.clientEventWaiters.get(eventName) || [];
    if (waiters.length) {
      waiters.shift()(payload);
      return;
    }

    const queue = this.clientEvents.get(eventName) || [];
    queue.push(payload);
    this.clientEvents.set(eventName, queue);
  }

  nextClientEvent(eventName) {
    const queued = this.clientEvents.get(eventName) || [];
    if (queued.length) return Promise.resolve(queued.shift());

    return new Promise((resolve, reject) => {
      const waiters = this.clientEventWaiters.get(eventName) || [];
      const waiter = (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      };
      const timeout = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${eventName}`));
      }, 1000);
      waiters.push(waiter);
      this.clientEventWaiters.set(eventName, waiters);
    });
  }

  clientEmit(eventName, payload) {
    const handler = this.listeners.get(eventName)?.[0];
    assert.ok(handler, `Expected server handler for ${eventName}`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${eventName} ack`));
      }, 1000);
      const callback = (result) => {
        clearTimeout(timeout);
        resolve(result);
      };

      Promise.resolve(handler(payload, callback)).catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }
}

io = new FakeIo();
process.env.JWT_SECRET = tokenSecret;
User.findById = () => ({
  select: () =>
    Promise.resolve({ name: "Audio Tester", email: "audio@example.test" }),
});
Project.findOne = (query) => ({
  select: () =>
    Promise.resolve(
      query._id === projectId ? { _id: projectId, members: [] } : null
    ),
});
registerSocketHandlers(io);
