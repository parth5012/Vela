import { parseUrl } from '../utils/notificationRouting';

describe('Briefing Navigation & Screens', () => {
  it('parses briefing settings deep link correctly', () => {
    const res = parseUrl('vela-client://settings/briefing');
    expect(res).toEqual({
      type: 'briefing',
      route: '/settings/briefing',
    });
  });

  it('parses briefing history deep link correctly', () => {
    const res = parseUrl('vela-client://briefing');
    expect(res).toEqual({
      type: 'briefing',
      route: '/briefing',
    });
  });
});
