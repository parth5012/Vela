import {
  parseNotificationData,
  buildDeepLink,
  parseUrl,
  parseDeepLinkUrl,
  routeByType,
} from '../utils/notificationRouting';

describe('notificationRouting', () => {
  describe('parseNotificationData', () => {
    it('returns empty type for null/undefined', () => {
      expect(parseNotificationData(null)).toEqual({ type: '' });
      expect(parseNotificationData(undefined)).toEqual({ type: '' });
    });

    it('parses type and conversation_id', () => {
      expect(parseNotificationData({ type: 'task_completion', conversation_id: 'abc-123' })).toEqual({
        type: 'task_completion',
        conversation_id: 'abc-123',
      });
    });

    it('strips conversation/ prefix from conversation_id value', () => {
      expect(parseNotificationData({ type: 'task_completion', conversation_id: 'conversation/abc-123' })).toEqual({
        type: 'task_completion',
        conversation_id: 'abc-123',
      });
    });

    it('strips chat/ prefix from conversation_id value', () => {
      expect(parseNotificationData({ type: 'calendar_reminder', conversation_id: 'chat/xyz' })).toEqual({
        type: 'calendar_reminder',
        conversation_id: 'xyz',
      });
    });

    it('handles full deep-link as conversation_id value', () => {
      expect(
        parseNotificationData({ type: 'briefing', conversation_id: 'vela-client://conversation/my-id' }),
      ).toEqual({ type: 'briefing', conversation_id: 'my-id' });
    });

    it('handles chat alias deep-link as conversation_id value', () => {
      expect(
        parseNotificationData({ type: 'checkin', conversation_id: 'vela-client://chat/my-id' }),
      ).toEqual({ type: 'checkin', conversation_id: 'my-id' });
    });

    it('trims whitespace', () => {
      expect(parseNotificationData({ type: '  task_completion ', conversation_id: '  abc ' })).toEqual({
        type: 'task_completion',
        conversation_id: 'abc',
      });
    });
  });

  describe('buildDeepLink', () => {
    it('returns null when no conversation_id', () => {
      expect(buildDeepLink({ type: 'task_completion' })).toBeNull();
      expect(buildDeepLink(null)).toBeNull();
    });

    it('returns canonical vela-client://conversation/{id}', () => {
      expect(buildDeepLink({ type: 'task_completion', conversation_id: 'abc-123' })).toBe(
        'vela-client://conversation/abc-123',
      );
    });

    it('canonicalizes chat alias input', () => {
      expect(buildDeepLink({ conversation_id: 'chat/abc' } as unknown as Record<string, string>)).toBe(
        'vela-client://conversation/abc',
      );
    });
  });

  describe('parseUrl', () => {
    it('parses canonical conversation deep-link', () => {
      expect(parseUrl('vela-client://conversation/abc-123')).toEqual({
        type: '',
        conversation_id: 'abc-123',
      });
    });

    it('parses chat alias deep-link', () => {
      expect(parseUrl('vela-client://chat/xyz-789')).toEqual({ type: '', conversation_id: 'xyz-789' });
    });

    it('parses briefing deep-link URLs', () => {
      expect(parseUrl('vela-client://briefing')).toEqual({
        type: 'briefing',
        route: '/briefing',
      });
      expect(parseUrl('vela-client://settings/briefing')).toEqual({
        type: 'briefing',
        route: '/settings/briefing',
      });
    });

    it('returns null for invalid/missing id', () => {
      expect(parseUrl('vela-client://conversation/')).toBeNull();
      expect(parseUrl('vela-client://')).toBeNull();
      expect(parseUrl(null)).toBeNull();
      expect(parseUrl('')).toBeNull();
    });

    it('strips query and hash', () => {
      expect(parseUrl('vela-client://conversation/abc?foo=1#hash')).toEqual({
        type: '',
        conversation_id: 'abc',
      });
    });

    it('parseDeepLinkUrl is alias of parseUrl', () => {
      expect(parseDeepLinkUrl).toBe(parseUrl);
    });
  });

  describe('routeByType', () => {
    const makeRouter = () => ({ replace: jest.fn() });
    const makeSelectThread = () => jest.fn();

    it('task_completion with id selects thread and replaces /', () => {
      const router = makeRouter();
      const selectThread = makeSelectThread();
      routeByType({ type: 'task_completion', conversation_id: 'tid-1' }, router, selectThread);
      expect(selectThread).toHaveBeenCalledWith('tid-1');
      expect(router.replace).toHaveBeenCalledWith('/');
    });

    it('calendar_reminder with id selects thread', () => {
      const router = makeRouter();
      const selectThread = makeSelectThread();
      routeByType({ type: 'calendar_reminder', conversation_id: 'cid' }, router, selectThread);
      expect(selectThread).toHaveBeenCalledWith('cid');
      expect(router.replace).toHaveBeenCalledWith('/');
    });

    it('briefing with id selects thread (future /briefing-history)', () => {
      const router = makeRouter();
      const selectThread = makeSelectThread();
      routeByType({ type: 'briefing', conversation_id: 'bid' }, router, selectThread);
      expect(selectThread).toHaveBeenCalledWith('bid');
      expect(router.replace).toHaveBeenCalledWith('/');
    });

    it('checkin with id selects thread (future /journal)', () => {
      const router = makeRouter();
      const selectThread = makeSelectThread();
      routeByType({ type: 'checkin', conversation_id: 'jid' }, router, selectThread);
      expect(selectThread).toHaveBeenCalledWith('jid');
      expect(router.replace).toHaveBeenCalledWith('/');
    });

    it('unknown type with id still selects thread', () => {
      const router = makeRouter();
      const selectThread = makeSelectThread();
      routeByType({ type: 'unknown_type', conversation_id: 'x' }, router, selectThread);
      expect(selectThread).toHaveBeenCalledWith('x');
      expect(router.replace).toHaveBeenCalledWith('/');
    });

    it('missing conversation_id does not call selectThread', () => {
      const router = makeRouter();
      const selectThread = makeSelectThread();
      routeByType({ type: 'task_completion' }, router, selectThread);
      expect(selectThread).not.toHaveBeenCalled();
      expect(router.replace).toHaveBeenCalledWith('/');
    });

    it('null data routes to / without selectThread', () => {
      const router = makeRouter();
      const selectThread = makeSelectThread();
      routeByType(null, router, selectThread);
      expect(selectThread).not.toHaveBeenCalled();
      expect(router.replace).toHaveBeenCalledWith('/');
    });

    it('handles chat/ prefix in conversation_id', () => {
      const router = makeRouter();
      const selectThread = makeSelectThread();
      routeByType({ type: 'task_completion', conversation_id: 'chat/my-id' }, router, selectThread);
      expect(selectThread).toHaveBeenCalledWith('my-id');
    });
  });
});
