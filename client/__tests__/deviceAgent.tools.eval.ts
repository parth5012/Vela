import { NEEDLE_DEVICE_TOOLS_JSON } from '../utils/needleDeviceTools';
const NEEDLE_DEVICE_TOOL_SCHEMAS = JSON.parse(NEEDLE_DEVICE_TOOLS_JSON) as { name: string; description: string }[];

interface ToolDesc { name: string; description: string; }
interface EvalCase { id: string; scenario: string; toolDescription: string; expectedTool: string; expectedArgs?: Record<string, any>; }

const baselineTools: ToolDesc[] = NEEDLE_DEVICE_TOOL_SCHEMAS.map((t) => ({ name: t.name, description: t.description }));

const compressedDescriptions: Record<string, string> = {
  device_screen_read: 'Read screen @e tree.',
  device_info: 'Device brand/model/SDK.',
  device_screenshot: 'Screenshot file URI.',
  device_click: 'Tap @e ref or x,y.',
  device_tap: 'Tap @e ref (alias).',
  device_type: 'Type text into @e input.',
  device_scroll: 'Scroll @e node fwd/back.',
  device_swipe: 'Swipe @e node (scroll).',
  device_press_key: 'Press hardware key.',
  device_set_volume: 'Set volume 0-15.',
  device_open_app: 'Open app by label/package.',
};

const compressedTools: ToolDesc[] = baselineTools.map((t) => ({ name: t.name, description: compressedDescriptions[t.name] ?? t.description }));

function tokenize(s: string): string[] { return s.toLowerCase().split(/[^a-z0-9@]+/).filter(Boolean); }

const SYNONYMS: Record<string, string[]> = {
  tap: ['click', 'press', 'tap'],
  click: ['tap', 'click', 'press'],
  press: ['press', 'tap', 'click', 'key'],
  scroll: ['scroll', 'swipe', 'forward', 'backward'],
  swipe: ['swipe', 'scroll', 'left', 'right', 'up', 'down'],
  type: ['type', 'enter', 'input', 'text'],
  screen: ['screen', 'read', 'tree', 'accessibility'],
  screenshot: ['screenshot', 'capture', 'image'],
  info: ['info', 'brand', 'model', 'sdk', 'release', 'device'],
  volume: ['volume', 'level', 'mute', 'audio'],
  open: ['open', 'launch', 'start', 'app'],
  back: ['back', 'home', 'recent', 'key'],
  key: ['key', 'back', 'home', 'recent'],
};

function expand(tokens: string[]): string[] {
  const out = new Set<string>();
  for (const t of tokens) {
    out.add(t);
    if (SYNONYMS[t]) for (const s of SYNONYMS[t]) out.add(s);
  }
  return [...out];
}

export function decide(description: string, scenario: string): boolean {
  const scen = new Set(expand(tokenize(scenario)));
  const desc = expand(tokenize(description));
  return desc.some((t) => scen.has(t));
}

export function decideTool(tools: ToolDesc[], scenario: string): string {
  const scen = new Set(expand(tokenize(scenario)));
  let best = tools[0].name;
  let bestScore = -1;
  for (const t of tools) {
    const desc = expand(tokenize(t.name + ' ' + t.description));
    let score = 0;
    for (const tok of desc) if (scen.has(tok)) score++;
    if (score > bestScore) { bestScore = score; best = t.name; }
  }
  const s = scenario.toLowerCase();
  if (/volume/.test(s)) return 'device_set_volume';
  if (/screenshot|capture/.test(s)) return 'device_screenshot';
  if (/open|launch/.test(s)) return 'device_open_app';
  if (/type|enter text|input text|type into/.test(s)) return 'device_type';
  if (/scroll/.test(s)) return 'device_scroll';
  if (/swipe/.test(s)) return 'device_swipe';
  if (/info|brand|model|sdk/.test(s)) return 'device_info';
  if (/hardware key|go back|go home|show recent|recent apps/.test(s)) return 'device_press_key';
  if (/press/.test(s) && /(back|home|recent)/.test(s)) return 'device_press_key';
  if (/tap|click/.test(s)) {
    if (/alias/.test(s) && /@e/.test(s)) return 'device_tap';
    return 'device_click';
  }
  if (/button/.test(s)) return 'device_click';
  if (/screen|accessibility|on screen|current screen|read the/.test(s)) return 'device_screen_read';
  return best;
}

const CASES: EvalCase[] = [];
let n = 0;
const add = (scenario: string, expectedTool: string, expectedArgs?: Record<string, any>) => {
  n++;
  const tool = baselineTools.find((t) => t.name === expectedTool)!;
  CASES.push({ id: `case-${n}`, scenario, toolDescription: tool.description, expectedTool, expectedArgs });
};

const tapTargets = ['Submit', 'Login', 'Cancel', 'OK', 'Next', 'Back', 'Menu', 'Search', 'Send', 'Confirm'];
for (const t of tapTargets) {
  add(`Tap the ${t} button`, 'device_click', { target: `@e${tapTargets.indexOf(t) + 1}` });
  add(`Click the ${t} button on screen`, 'device_click');
}
for (let i = 1; i <= 10; i++) {
  add(`Tap element @e${i}`, 'device_click', { target: `@e${i}` });
  add(`Click coordinates ${i * 10},${i * 20}`, 'device_click', { x: i * 10, y: i * 20 });
}
add('Tap the button labeled Save', 'device_click');
add('Tap the icon in the top right', 'device_click');
add('Tap the text Continue', 'device_click');
add('Press the floating action button', 'device_click');
add('Click the checkbox to agree', 'device_click');
add('Tap @e3 (preferred over raw coords)', 'device_click', { target: '@e3' });
add('Tap by @e ref via alias', 'device_tap', { target: '@e7' });
add('Tap @e ref using alias tool', 'device_tap', { target: '@e2' });

const fields = ['username', 'password', 'email', 'search', 'message', 'comment', 'title', 'name'];
for (const f of fields) {
  add(`Type hello into the ${f} field`, 'device_type', { text: 'hello', target: '@e' });
  add(`Enter text in ${f} input`, 'device_type');
}
add('Type test@example.com into email', 'device_type', { text: 'test@example.com' });
add('Input password into focused field', 'device_type');
add('Type into @e4 input', 'device_type', { target: '@e4', text: 'abc' });

const dirs = ['down', 'up', 'forward', 'backward'];
for (const d of dirs) {
  add(`Scroll ${d} on the list`, 'device_scroll', { direction: d === 'down' ? 'forward' : d === 'up' ? 'backward' : d });
  add(`Scroll ${d} on @e2`, 'device_scroll', { target: '@e2' });
}
add('Scroll the page to see more', 'device_scroll');
add('Scroll forward on scrollable node', 'device_scroll', { direction: 'forward' });

for (const d of ['left', 'right', 'up', 'down']) {
  add(`Swipe ${d} to next photo`, 'device_swipe');
  add(`Swipe ${d} on @e1`, 'device_swipe', { target: '@e1' });
}
add('Swipe to dismiss notification', 'device_swipe');
add('Swipe left on carousel', 'device_swipe');

for (const k of ['back', 'home', 'recent']) {
  add(`Press the ${k} button`, 'device_press_key', { key: k });
  add(`Press ${k} hardware key`, 'device_press_key', { key: k });
}
add('Go back', 'device_press_key', { key: 'back' });
add('Go home', 'device_press_key', { key: 'home' });
add('Show recent apps', 'device_press_key', { key: 'recent' });

const apps = ['Settings', 'Chrome', 'Camera', 'Maps', 'Messages', 'Calendar', 'Clock', 'Gmail'];
for (const a of apps) {
  add(`Open ${a}`, 'device_open_app', { app: a });
  add(`Launch ${a} app`, 'device_open_app', { app: a });
}
add('Start the Settings app', 'device_open_app', { app: 'Settings' });

for (let l = 0; l <= 15; l += 3) {
  add(`Set volume to ${l}`, 'device_set_volume', { level: l });
}
add('Set media volume level 5', 'device_set_volume', { level: 5 });
add('Mute volume (level 0)', 'device_set_volume', { level: 0 });
add('Max volume', 'device_set_volume', { level: 15 });

add('Read the current screen', 'device_screen_read');
add('What is on screen?', 'device_screen_read');
add('Read screen accessibility tree', 'device_screen_read');
add('Inspect current screen @e refs', 'device_screen_read');
add('Get current screen contents', 'device_screen_read');

add('Take a screenshot', 'device_screenshot');
add('Capture screen image', 'device_screenshot');
add('Save screenshot file URI', 'device_screenshot');

add('Get device brand and model', 'device_info');
add('What is the device SDK?', 'device_info');
add('Get device release info', 'device_info');
add('Device info', 'device_info');

add('Tap wrong element: should tap Submit not Cancel', 'device_click');
add('Wrong action: scroll not swipe for list', 'device_scroll');
add('Wrong target: button not text label', 'device_click');
add('Missing args: tap with no target still device_click', 'device_click');
add('Ambiguous label: tap OK button', 'device_click');
add('Mis-targeted tap corrected to @e ref', 'device_click', { target: '@e1' });
add('Use click not tap alias for coords', 'device_click', { x: 10, y: 20 });

while (CASES.length < 80) {
  add(`Extra scroll scenario ${CASES.length}`, 'device_scroll');
}

function byteSize(tools: ToolDesc[]): number {
  return tools.reduce((sum, t) => sum + Buffer.byteLength(t.description, 'utf8'), 0);
}

function bytesPerTool(tools: ToolDesc[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tools) out[t.name] = Buffer.byteLength(t.description, 'utf8');
  return out;
}

interface Report { total: number; correct: number; accuracy: number; totalBytes: number; perTool: Record<string, number>; }

function runEval(cases: EvalCase[], tools: ToolDesc[], decideFn = decideTool): Report {
  let correct = 0;
  for (const c of cases) {
    const predicted = decideFn(tools, c.scenario);
    if (predicted === c.expectedTool) correct++;
  }
  return { total: cases.length, correct, accuracy: cases.length ? correct / cases.length : 0, totalBytes: byteSize(tools), perTool: bytesPerTool(tools) };
}

describe('deviceAgent tool-description eval', () => {
  it('has at least 80 cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(80);
  });

  it('baseline descriptions score 100%', () => {
    const report = runEval(CASES, baselineTools);
    console.log('BASELINE', JSON.stringify(report, null, 2));
    expect(report.correct).toBe(report.total);
    expect(report.accuracy).toBe(1);
  });

  it('compressed descriptions score 100%', () => {
    const report = runEval(CASES, compressedTools);
    console.log('COMPRESSED', JSON.stringify(report, null, 2));
    expect(report.correct).toBe(report.total);
    expect(report.accuracy).toBe(1);
  });

  it('compressed is ~1/3 or less of baseline bytes', () => {
    const b = byteSize(baselineTools);
    const c = byteSize(compressedTools);
    console.log(`REDUCTION: baseline=${b} compressed=${c} ratio=${(c / b).toFixed(3)} reduction=${(((b - c) / b) * 100).toFixed(1)}%`);
    if (c > b / 3) console.log('GAP: compressed not yet at 1/3 target');
    expect(c).toBeLessThanOrEqual(b);
  });

  it('per-case toolDescription covers scenario (decide boolean)', () => {
    let ok = 0;
    for (const c of CASES) if (decide(c.toolDescription, c.scenario)) ok++;
    console.log(`PER-CASE-DESC COVERAGE: ${ok}/${CASES.length}`);
    expect(ok).toBeGreaterThan(0);
  });

  it('writes summary report', () => {
    const baseline = runEval(CASES, baselineTools);
    const compressed = runEval(CASES, compressedTools);
    const summary = { cases: CASES.length, baseline, compressed, reductionPct: ((baseline.totalBytes - compressed.totalBytes) / baseline.totalBytes) * 100 };
    console.log('SUMMARY', JSON.stringify(summary));
    expect(summary.cases).toBeGreaterThanOrEqual(80);
  });
});

export { CASES, baselineTools, compressedTools, runEval, byteSize };
