import {
  parseNetscapeCookies,
  parseChromeJson,
  filterBySelectedDomains,
  groupEntriesByDomain,
  importCookies,
} from '../utils/cookieSync';

describe('parseNetscapeCookies', () => {
  it('parses basic Netscape file', () => {
    const txt = [
      '# Netscape HTTP Cookie File',
      '# https://example.com',
      '.example.com\tTRUE\t/\tFALSE\t1735689600\tSESSION\tvalue123',
      'api.example.com\tTRUE\t/api\tTRUE\t0\ttoken\tabc',
    ].join('\n');
    const entries = parseNetscapeCookies(txt);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ domain: '.example.com', name: 'SESSION', value: 'value123', path: '/', secure: false });
    expect(entries[0].expires).toBe(1735689600);
    expect(entries[1].secure).toBe(true);
    expect(entries[1].expires).toBeNull(); // 0 -> null
  });

  it('handles #HttpOnly_ prefix', () => {
    const txt = '#HttpOnly_.example.com\tTRUE\t/\tFALSE\t0\tSECURE\tsecret\n';
    const entries = parseNetscapeCookies(txt);
    expect(entries[0].httpOnly).toBe(true);
    expect(entries[0].domain).toBe('.example.com');
  });

  it('ignores comment lines and empty lines', () => {
    const txt = '# comment\n\n   \n.example.com\tTRUE\t/\tFALSE\t0\ta\tb\n';
    expect(parseNetscapeCookies(txt)).toHaveLength(1);
  });

  it('returns empty for invalid content', () => {
    expect(parseNetscapeCookies('not a cookie file')).toHaveLength(0);
    expect(parseNetscapeCookies('')).toHaveLength(0);
  });
});

describe('parseChromeJson', () => {
  it('parses array of Chrome cookies', () => {
    const json = JSON.stringify([
      { domain: '.example.com', name: 'a', value: '1', path: '/', secure: true, httpOnly: true, expirationDate: 1735689600.5 },
      { domain: 'other.com', name: 'b', value: '2' },
    ]);
    const entries = parseChromeJson(json);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ domain: '.example.com', name: 'a', secure: true, httpOnly: true });
    expect(entries[0].expires).toBe(1735689600); // floored
    expect(entries[1].path).toBe('/');
  });

  it('parses wrapped {cookies: []} object', () => {
    const json = JSON.stringify({ cookies: [{ domain: 'x.com', name: 'c', value: 'v' }] });
    expect(parseChromeJson(json)).toHaveLength(1);
  });

  it('returns empty for invalid JSON', () => {
    expect(parseChromeJson('not json')).toHaveLength(0);
    expect(parseChromeJson('{}')).toHaveLength(0);
    expect(parseChromeJson('[]')).toHaveLength(0);
  });

  it('skips entries without domain or name', () => {
    const json = JSON.stringify([{ domain: '', name: 'a', value: 'v' }, { domain: 'x.com', name: '', value: 'v' }]);
    expect(parseChromeJson(json)).toHaveLength(0);
  });
});

describe('filterBySelectedDomains', () => {
  it('filters by normalized domain', () => {
    const entries = [
      { domain: '.Example.COM', name: 'a', value: '1', path: '/', expires: null, secure: false, httpOnly: false },
      { domain: 'other.com', name: 'b', value: '2', path: '/', expires: null, secure: false, httpOnly: false },
    ];
    const selected = new Set(['example.com']);
    const filtered = filterBySelectedDomains(entries, selected);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].domain).toBe('.Example.COM');
  });

  it('returns empty for empty selected set', () => {
    const entries = [{ domain: 'a.com', name: 'n', value: 'v', path: '/', expires: null, secure: false, httpOnly: false }];
    expect(filterBySelectedDomains(entries, new Set())).toHaveLength(0);
  });
});

describe('groupEntriesByDomain', () => {
  it('groups by normalized domain', () => {
    const entries = [
      { domain: '.example.com', name: 'a', value: '1', path: '/', expires: null, secure: false, httpOnly: false },
      { domain: 'EXAMPLE.com', name: 'b', value: '2', path: '/', expires: null, secure: false, httpOnly: false },
      { domain: 'other.com', name: 'c', value: '3', path: '/', expires: null, secure: false, httpOnly: false },
    ];
    const grouped = groupEntriesByDomain(entries);
    expect(Object.keys(grouped)).toHaveLength(2);
    expect(grouped['example.com']).toHaveLength(2);
    expect(grouped['other.com']).toHaveLength(1);
  });
});

describe('importCookies fallback without native manager', () => {
  it('returns imported counts when CookieManager not available (web/jest)', async () => {
    const entries = [
      { domain: 'example.com', name: 'a', value: '1', path: '/', expires: null, secure: false, httpOnly: false },
      { domain: 'example.com', name: 'b', value: '2', path: '/', expires: null, secure: false, httpOnly: false },
    ];
    const result = await importCookies(entries, ['example.com']);
    // In jest, CookieManager is absent so we get no-op success
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(0);
  });
});
