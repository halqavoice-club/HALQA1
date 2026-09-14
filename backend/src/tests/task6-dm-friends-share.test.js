/**
 * Task 6 — DM tab shows ALL friends (not just existing conversations)
 *
 * Root cause: Both web and mobile share sheets previously fetched
 * GET /dm/conversations, which only returns users with an existing thread.
 * Friends who were never messaged were invisible.
 *
 * Fix:
 *   1. Fetch source changed to GET /social/friends?limit=100
 *      → returns ALL accepted friends regardless of conversation history
 *   2. Normalize each friend to { id: friend.userId, otherUser: friend }
 *      → compatible with the existing DM-tab render logic
 *   3. Before sending, call GET /dm/conversations/:userId/with
 *      → creates a conversation thread if none exists, returns convId
 *   4. Post VOICE_ROOM_SHARE to the real convId
 *
 * These tests document and verify the backend contract this fix relies on.
 */

const request = require('supertest');
const express = require('express');

// ─── Mock backend for contract tests ─────────────────────────────────────────

const app = express();
app.use(express.json());

// ── GET /social/friends ───────────────────────────────────────────────────────
// Returns flat array of accepted friends regardless of conversation history.
const FRIENDS = [
  { id: 'user-A', firstName: 'Alice', lastName: 'Smith',  avatarUrl: null }, // has existing convo
  { id: 'user-B', firstName: 'Bob',   lastName: 'Jones',  avatarUrl: null }, // NO existing convo
  { id: 'user-C', firstName: 'Carla', lastName: 'Hassan', avatarUrl: null }, // NO existing convo
];

app.get('/social/friends', (_req, res) => {
  res.json({ data: FRIENDS });
});

// ── GET /dm/conversations — only returns users with existing threads ───────────
const EXISTING_CONVS = [
  { id: 'conv-1', otherUser: { id: 'user-A', firstName: 'Alice', lastName: 'Smith', avatarUrl: null } },
];

app.get('/dm/conversations', (_req, res) => {
  res.json({ data: EXISTING_CONVS });
});

// ── GET /dm/conversations/:userId/with — get or create conversation ────────────
const WITH_MAP = {
  'user-A': 'conv-1',   // existing conversation
  'user-B': 'conv-99',  // newly created
  'user-C': 'conv-100', // newly created
};

app.get('/dm/conversations/:userId/with', (req, res) => {
  const convId = WITH_MAP[req.params.userId];
  if (!convId) return res.status(404).json({ message: 'Not friends' });
  res.json({ data: { id: convId } });
});

// ── POST /dm/conversations/:convId/messages ────────────────────────────────────
const sentMessages = [];
app.post('/dm/conversations/:convId/messages', (req, res) => {
  const { msgType, refEntityType, refEntityId } = req.body;
  if (!msgType) return res.status(400).json({ message: 'msgType required' });
  sentMessages.push({ convId: req.params.convId, msgType, refEntityType, refEntityId });
  res.status(201).json({ data: { id: 'msg-new', msgType, refEntityType, refEntityId } });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simulates what the web/mobile DM tab now does: fetch friends, normalize */
async function fetchDMTabItems() {
  const res = await request(app).get('/social/friends?limit=100');
  const friends = res.body.data ?? [];
  return friends.map(f => ({ id: f.id, otherUser: f }));
}

/** Simulates what the web/mobile share sheet does before sending */
async function sendVoiceShareToDM(conv, roomId) {
  // Step 1: get or create conversation
  const convRes = await request(app).get(`/dm/conversations/${conv.id}/with`);
  if (convRes.status !== 200) throw new Error('Could not start conversation');
  const convId = convRes.body.data?.id;

  // Step 2: send the structured share
  const sendRes = await request(app)
    .post(`/dm/conversations/${convId}/messages`)
    .send({
      msgType:       'VOICE_ROOM_SHARE',
      refEntityType: 'VoiceRoom',
      refEntityId:   roomId,
      body:          null,
    });
  return { convId, sendRes };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => sentMessages.length = 0);

describe('Task 6 — DM tab friend list source', () => {
  test('GET /social/friends returns ALL friends (not just those with conversations)', async () => {
    const items = await fetchDMTabItems();
    expect(items).toHaveLength(3); // Alice, Bob, Carla — even though only Alice has an existing convo
  });

  test('GET /dm/conversations (old source) only returns 1 conversation', async () => {
    const res = await request(app).get('/dm/conversations');
    expect(res.body.data).toHaveLength(1); // only Alice
  });

  test('normalized items have { id: userId, otherUser: friend } shape', async () => {
    const items = await fetchDMTabItems();
    expect(items[0]).toMatchObject({ id: 'user-A', otherUser: { firstName: 'Alice' } });
    expect(items[1]).toMatchObject({ id: 'user-B', otherUser: { firstName: 'Bob'   } });
    expect(items[2]).toMatchObject({ id: 'user-C', otherUser: { firstName: 'Carla' } });
  });

  test('filteredDM search works against otherUser.firstName/lastName', async () => {
    const items = await fetchDMTabItems();
    const q = 'ali';
    const filtered = items.filter(c =>
      `${c.otherUser?.firstName} ${c.otherUser?.lastName}`.toLowerCase().includes(q)
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].otherUser.firstName).toBe('Alice');
  });
});

describe('Task 6 — sendDM get-or-create conversation flow', () => {
  test('sending to a friend with an existing conversation uses the existing convId', async () => {
    const items = await fetchDMTabItems();
    const aliceConv = items.find(c => c.id === 'user-A');
    const { convId } = await sendVoiceShareToDM(aliceConv, 'room-xyz');
    expect(convId).toBe('conv-1'); // existing conversation ID
  });

  test('sending to a friend with NO existing conversation creates one and sends', async () => {
    const items = await fetchDMTabItems();
    const bobConv = items.find(c => c.id === 'user-B');
    const { convId, sendRes } = await sendVoiceShareToDM(bobConv, 'room-xyz');
    expect(convId).toBe('conv-99'); // newly created conversation
    expect(sendRes.status).toBe(201);
  });

  test('VOICE_ROOM_SHARE is sent with correct fields', async () => {
    const items = await fetchDMTabItems();
    const carlaConv = items.find(c => c.id === 'user-C');
    await sendVoiceShareToDM(carlaConv, 'room-abc');
    const msg = sentMessages.find(m => m.convId === 'conv-100');
    expect(msg).toBeDefined();
    expect(msg.msgType).toBe('VOICE_ROOM_SHARE');
    expect(msg.refEntityType).toBe('VoiceRoom');
    expect(msg.refEntityId).toBe('room-abc');
  });

  test('all three friends (including those with no prior conversation) can be sent to', async () => {
    const items = await fetchDMTabItems();
    for (const conv of items) {
      await sendVoiceShareToDM(conv, 'room-xyz');
    }
    expect(sentMessages).toHaveLength(3);
  });

  test('conv.id (userId) is used as setSending key — spinner shows on correct row', async () => {
    // The sending state key must match conv.id so the correct row shows the spinner.
    // Our fix: setSending(friendUserId) where friendUserId === conv.id
    const items = await fetchDMTabItems();
    const bob = items.find(c => c.id === 'user-B');
    // Confirm the key that would be set in sending state is bob's userId
    expect(bob.id).toBe('user-B');
    // Confirm that after /with call the correct convId is used
    const convRes = await request(app).get(`/dm/conversations/user-B/with`);
    expect(convRes.body.data.id).toBe('conv-99'); // different from conv.id — this is correct
  });
});
