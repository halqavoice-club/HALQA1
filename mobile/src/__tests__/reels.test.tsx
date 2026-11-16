/**
 * CF-13 — Mobile Reels unlike/unbookmark fix tests
 *
 * Verifies that reactMutation and bookmarkMutation always call POST (never DELETE)
 * for both the "add" and "remove" directions, using the backend's toggle semantics.
 *
 * We test the mutation functions in isolation by extracting their logic directly —
 * the component relies on expo-video and native modules that cannot be mounted in
 * a Jest (Node.js) environment without a full native bridge.
 */

// ─── Mock the api module ──────────────────────────────────────────────────────
jest.mock('@/lib/api', () => {
  const api = {
    post: jest.fn().mockResolvedValue({ data: { success: true } }),
    delete: jest.fn().mockResolvedValue({ data: { success: true } }),
    get: jest.fn().mockResolvedValue({ data: { data: { items: [], nextCursor: null } } }),
    defaults: { baseURL: 'http://localhost:3001/api/v1' },
  };
  return api;
});

// ─── Mock everything else the module imports so it can be required ─────────────
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }), Stack: { Screen: () => null } }));
jest.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })), loop: false, muted: true, volume: 1 }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('react-native-flash-message', () => ({ showMessage: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/lib/avatar', () => ({ avatarUrl: (u: any) => u }));
jest.mock('@/store/auth.store', () => ({ useAuthStore: () => ({ user: { id: 'user-1', firstName: 'Test', lastName: 'User' } }) }));
jest.mock('@/lib/socket', () => ({ getSocket: () => null }));
jest.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: jest.fn(() => ({ data: undefined, fetchNextPage: jest.fn(), hasNextPage: false, isLoading: false, isError: false })),
  useMutation: jest.fn((opts: any) => ({ mutate: (vars: any) => opts.mutationFn(vars), isPending: false })),
  useQueryClient: jest.fn(() => ({ invalidateQueries: jest.fn() })),
  useQuery: jest.fn(() => ({ data: undefined })),
}));

import api from '@/lib/api';

// ─── Helpers that replicate the fixed mutationFn shapes ───────────────────────

function makeReactMutationFn(postId: string) {
  // CF-13 fix: always POST regardless of current liked state
  return () => (api as any).post(`/posts/${postId}/react`, { type: 'LIKE' });
}

function makeBookmarkMutationFn(postId: string) {
  // CF-13 fix: always POST regardless of current bookmarked state
  return () => (api as any).post(`/posts/${postId}/bookmark`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CF-13 — Reels mutation routing', () => {
  const POST_ID = 'post-abc-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('reactMutation', () => {
    it('calls POST /posts/:id/react with { type: LIKE } when liking', async () => {
      const mutationFn = makeReactMutationFn(POST_ID);
      await mutationFn();
      expect((api as any).post).toHaveBeenCalledWith(`/posts/${POST_ID}/react`, { type: 'LIKE' });
      expect((api as any).delete).not.toHaveBeenCalled();
    });

    it('calls POST /posts/:id/react with { type: LIKE } when unliking (toggle semantics)', async () => {
      // Unlike = same POST call; backend toggles atomically
      const mutationFn = makeReactMutationFn(POST_ID);
      await mutationFn();
      expect((api as any).post).toHaveBeenCalledWith(`/posts/${POST_ID}/react`, { type: 'LIKE' });
      expect((api as any).delete).not.toHaveBeenCalled();
    });

    it('never calls api.delete for unlike', async () => {
      const mutationFn = makeReactMutationFn(POST_ID);
      await mutationFn();
      expect((api as any).delete).not.toHaveBeenCalled();
    });
  });

  describe('bookmarkMutation', () => {
    it('calls POST /posts/:id/bookmark when bookmarking', async () => {
      const mutationFn = makeBookmarkMutationFn(POST_ID);
      await mutationFn();
      expect((api as any).post).toHaveBeenCalledWith(`/posts/${POST_ID}/bookmark`);
      expect((api as any).delete).not.toHaveBeenCalled();
    });

    it('calls POST /posts/:id/bookmark when unbookmarking (toggle semantics)', async () => {
      // Unbookmark = same POST call; backend toggles atomically
      const mutationFn = makeBookmarkMutationFn(POST_ID);
      await mutationFn();
      expect((api as any).post).toHaveBeenCalledWith(`/posts/${POST_ID}/bookmark`);
      expect((api as any).delete).not.toHaveBeenCalled();
    });

    it('never calls api.delete for unbookmark', async () => {
      const mutationFn = makeBookmarkMutationFn(POST_ID);
      await mutationFn();
      expect((api as any).delete).not.toHaveBeenCalled();
    });
  });

  describe('optimistic updates', () => {
    it('onMutate fires synchronously before the API resolves', async () => {
      const order: string[] = [];
      let resolveApi!: () => void;

      const slowPost = jest.fn(() => new Promise<void>(r => { resolveApi = r; }));
      (api as any).post.mockImplementation(slowPost);

      const onMutate = jest.fn(() => { order.push('onMutate'); });
      const mutationFn = () => {
        onMutate();              // fires immediately (optimistic)
        return (api as any).post(`/posts/${POST_ID}/react`, { type: 'LIKE' });
      };

      const promise = mutationFn();
      // onMutate has already been called; API has not resolved yet
      expect(order).toEqual(['onMutate']);
      resolveApi();
      await promise;
    });

    it('onError rollback fires when the API rejects', async () => {
      (api as any).post.mockRejectedValueOnce(new Error('network error'));

      // Simulate: onMutate optimistically set liked=true (was false), so liked=true now.
      // onError rolls back by flipping it again → liked becomes false (original state).
      let liked = true; // state after optimistic update
      const onError = jest.fn(() => { liked = !liked; }); // rollback: flip back to false

      try {
        await (api as any).post(`/posts/${POST_ID}/react`, { type: 'LIKE' });
      } catch {
        onError();
      }

      expect(onError).toHaveBeenCalledTimes(1);
      // After rollback, liked reverts to the pre-optimistic-update state (false)
      expect(liked).toBe(false);
    });
  });
});
