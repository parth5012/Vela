# Intent and Skill UI Dropdowns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `<intent>` and `<skill>` collapsible dropdown blocks in the Vela Client message rendering feed.

**Architecture:** Extend the current `messageParser` utility to extract `intent` and `skill` segments, update `CollapsibleBlock` with custom themes/icons, and modify the message renderer in `index.tsx` to display intents above the bubble (like thoughts) and skills inside the bubble (like tool calls).

**Tech Stack:** React Native, Expo, TypeScript, Jest

---

### Task 1: Message Parser Tests

**Files:**
- Modify: `client/__tests__/messageParser.test.ts`

- [ ] **Step 1: Write the failing tests for intent and skill tags**

Add the following tests to `client/__tests__/messageParser.test.ts` inside the `describe('messageParser', ...)` block:

```typescript
  it('should parse closed intent block', () => {
    const text = '<intent>Goal is to list files.</intent>Ready.';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'intent',
        isClosed: true,
        children: [
          { type: 'text', content: 'Goal is to list files.', isClosed: true }
        ]
      },
      { type: 'text', content: 'Ready.', isClosed: true }
    ]);
  });

  it('should parse incomplete/streaming intent block', () => {
    const text = '<intent>Currently parsing intent';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'intent',
        isClosed: false,
        children: [
          { type: 'text', content: 'Currently parsing intent', isClosed: true }
        ]
      }
    ]);
  });

  it('should parse skill block with input', () => {
    const text = '<skill:custom_search input="{\\"query\\":\\"react\\"}">results</skill:custom_search>';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'skill',
        name: 'custom_search',
        input: '{\\"query\\":\\"react\\"}',
        isClosed: true,
        children: [
          { type: 'text', content: 'results', isClosed: true }
        ]
      }
    ]);
  });

  it('should parse incomplete/streaming skill block', () => {
    const text = '<skill:custom_search input="{\\"query\\":\\"react\\"}">fetching';
    const result = parseMessage(text);
    expect(result).toEqual([
      {
        type: 'skill',
        name: 'custom_search',
        input: '{\\"query\\":\\"react\\"}',
        isClosed: false,
        children: [
          { type: 'text', content: 'fetching', isClosed: true }
        ]
      }
    ]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run the tests inside the `client` directory:
Run: `npm test`
Expected: Compilation or test failures because `MessageSegment` type does not support `'intent'` or `'skill'`, and parsing logic is not implemented.

---

### Task 2: Message Parser Implementation

**Files:**
- Modify: `client/utils/messageParser.ts`

- [ ] **Step 1: Update type definitions and parsing logic**

Modify `client/utils/messageParser.ts` to include `'intent'` and `'skill'` in `MessageSegment.type`, add detection of `<intent>`, `</intent>`, `<skill:`, and `</skill` tags.

Replace the interface definition at the top of the file:
```typescript
export interface MessageSegment {
  type: 'text' | 'thought' | 'tool_call' | 'intent' | 'skill';
  content?: string;
  name?: string;
  input?: string;
  isClosed: boolean;
  children?: MessageSegment[];
}
```

And update the `parseMessage` function:
```typescript
export function parseMessage(content: string): MessageSegment[] {
  const root: MessageSegment = {
    type: 'text',
    isClosed: true,
    children: [],
  };

  const stack: MessageSegment[] = [root];
  let index = 0;

  const activeNode = () => stack[stack.length - 1];

  const addText = (text: string) => {
    if (!text) return;
    const current = activeNode();
    if (!current.children) {
      current.children = [];
    }
    const lastChild = current.children[current.children.length - 1];
    if (lastChild && lastChild.type === 'text') {
      lastChild.content += text;
    } else {
      current.children.push({
        type: 'text',
        content: text,
        isClosed: true,
      });
    }
  };

  while (index < content.length) {
    const textRemaining = content.slice(index);

    const nextThoughtOpen = textRemaining.indexOf('<thought>');
    const nextThoughtClose = textRemaining.indexOf('</thought>');
    const nextCallOpen = textRemaining.indexOf('<call:');
    const nextCallClose = textRemaining.indexOf('</call');
    
    // New targets
    const nextIntentOpen = textRemaining.indexOf('<intent>');
    const nextIntentClose = textRemaining.indexOf('</intent>');
    const nextSkillOpen = textRemaining.indexOf('<skill:');
    const nextSkillClose = textRemaining.indexOf('</skill');

    const targets: { pos: number; type: 'thought_open' | 'thought_close' | 'call_open' | 'call_close' | 'intent_open' | 'intent_close' | 'skill_open' | 'skill_close' }[] = [];
    if (nextThoughtOpen !== -1) targets.push({ pos: nextThoughtOpen, type: 'thought_open' });
    if (nextThoughtClose !== -1) targets.push({ pos: nextThoughtClose, type: 'thought_close' });
    if (nextCallOpen !== -1) targets.push({ pos: nextCallOpen, type: 'call_open' });
    if (nextCallClose !== -1) targets.push({ pos: nextCallClose, type: 'call_close' });
    if (nextIntentOpen !== -1) targets.push({ pos: nextIntentOpen, type: 'intent_open' });
    if (nextIntentClose !== -1) targets.push({ pos: nextIntentClose, type: 'intent_close' });
    if (nextSkillOpen !== -1) targets.push({ pos: nextSkillOpen, type: 'skill_open' });
    if (nextSkillClose !== -1) targets.push({ pos: nextSkillClose, type: 'skill_close' });

    targets.sort((a, b) => a.pos - b.pos);

    if (targets.length === 0) {
      addText(textRemaining);
      break;
    }

    const nextTarget = targets[0];

    if (nextTarget.pos > 0) {
      addText(textRemaining.slice(0, nextTarget.pos));
    }

    index += nextTarget.pos;

    if (nextTarget.type === 'thought_open') {
      index += 9;
      const newNode: MessageSegment = {
        type: 'thought',
        isClosed: false,
        children: [],
      };
      activeNode().children!.push(newNode);
      stack.push(newNode);
    } 
    else if (nextTarget.type === 'thought_close') {
      index += 10;
      if (stack.length > 1 && stack[stack.length - 1].type === 'thought') {
        const popped = stack.pop()!;
        popped.isClosed = true;
      }
    }
    else if (nextTarget.type === 'intent_open') {
      index += 8;
      const newNode: MessageSegment = {
        type: 'intent',
        isClosed: false,
        children: [],
      };
      activeNode().children!.push(newNode);
      stack.push(newNode);
    }
    else if (nextTarget.type === 'intent_close') {
      index += 9;
      if (stack.length > 1 && stack[stack.length - 1].type === 'intent') {
        const popped = stack.pop()!;
        popped.isClosed = true;
      }
    }
    else if (nextTarget.type === 'call_open') {
      const callRemaining = content.slice(index);
      const openTagRegex = /^<call:([a-zA-Z0-9_:]+)(?:\s+input=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'))?\s*>/;
      const openTagMatch = callRemaining.match(openTagRegex);

      if (!openTagMatch) {
        const nameMatch = callRemaining.match(/^<call:([a-zA-Z0-9_:]*)/);
        const name = nameMatch && nameMatch[1] ? nameMatch[1] : 'Tool';
        
        let input = '';
        const inputMatch = callRemaining.match(/input=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/);
        if (inputMatch) {
          input = inputMatch[1] || inputMatch[2] || '';
        } else {
          const partialInputMatch = callRemaining.match(/input=["']((?:[^"\\]|\\.)*)$/);
          if (partialInputMatch) {
            input = partialInputMatch[1];
          }
        }

        const newNode: MessageSegment = {
          type: 'tool_call',
          name,
          input,
          isClosed: false,
          children: [],
        };
        activeNode().children!.push(newNode);
        stack.push(newNode);
        break;
      }

      const toolName = openTagMatch[1];
      const inputVal = openTagMatch[2] || openTagMatch[3] || '';
      const openTagLength = openTagMatch[0].length;

      index += openTagLength;

      const newNode: MessageSegment = {
        type: 'tool_call',
        name: toolName,
        input: inputVal,
        isClosed: false,
        children: [],
      };
      activeNode().children!.push(newNode);
      stack.push(newNode);
    } 
    else if (nextTarget.type === 'call_close') {
      const closeRemaining = content.slice(index);
      const closeTagEndIdx = closeRemaining.indexOf('>');
      
      if (closeTagEndIdx === -1) {
        index = content.length;
      } else {
        index += closeTagEndIdx + 1;
        if (stack.length > 1 && stack[stack.length - 1].type === 'tool_call') {
          const popped = stack.pop()!;
          popped.isClosed = true;
        }
      }
    }
    else if (nextTarget.type === 'skill_open') {
      const skillRemaining = content.slice(index);
      const openTagRegex = /^<skill:([a-zA-Z0-9_:]+)(?:\s+input=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'))?\s*>/;
      const openTagMatch = skillRemaining.match(openTagRegex);

      if (!openTagMatch) {
        const nameMatch = skillRemaining.match(/^<skill:([a-zA-Z0-9_:]*)/);
        const name = nameMatch && nameMatch[1] ? nameMatch[1] : 'Skill';
        
        let input = '';
        const inputMatch = skillRemaining.match(/input=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/);
        if (inputMatch) {
          input = inputMatch[1] || inputMatch[2] || '';
        } else {
          const partialInputMatch = skillRemaining.match(/input=["']((?:[^"\\]|\\.)*)$/);
          if (partialInputMatch) {
            input = partialInputMatch[1];
          }
        }

        const newNode: MessageSegment = {
          type: 'skill',
          name,
          input,
          isClosed: false,
          children: [],
        };
        activeNode().children!.push(newNode);
        stack.push(newNode);
        break;
      }

      const skillName = openTagMatch[1];
      const inputVal = openTagMatch[2] || openTagMatch[3] || '';
      const openTagLength = openTagMatch[0].length;

      index += openTagLength;

      const newNode: MessageSegment = {
        type: 'skill',
        name: skillName,
        input: inputVal,
        isClosed: false,
        children: [],
      };
      activeNode().children!.push(newNode);
      stack.push(newNode);
    }
    else if (nextTarget.type === 'skill_close') {
      const closeRemaining = content.slice(index);
      const closeTagEndIdx = closeRemaining.indexOf('>');
      
      if (closeTagEndIdx === -1) {
        index = content.length;
      } else {
        index += closeTagEndIdx + 1;
        if (stack.length > 1 && stack[stack.length - 1].type === 'skill') {
          const popped = stack.pop()!;
          popped.isClosed = true;
        }
      }
    }
  }

  return root.children || [];
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add client/utils/messageParser.ts client/__tests__/messageParser.test.ts
git commit -m "feat: implement intent and skill tag parsing"
```

---

### Task 3: CollapsibleBlock Component Updates

**Files:**
- Modify: `client/components/chat/CollapsibleBlock.tsx`

- [ ] **Step 1: Update block themes, icons and types**

Modify `client/components/chat/CollapsibleBlock.tsx` to handle `'intent'` and `'skill'` type definitions.

Update `CollapsibleBlockProps`:
```typescript
interface CollapsibleBlockProps {
  type: 'thought' | 'tool_call' | 'intent' | 'skill';
  name?: string;
  input?: string;
  isClosed: boolean;
  themeColors: any;
  themeSizes: any;
  accentHex: string;
  children: React.ReactNode;
}
```

Update inside `CollapsibleBlock` component:
```typescript
  const isThought = type === 'thought';
  const isIntent = type === 'intent';
  const isSkill = type === 'skill';
  const isTool = type === 'tool_call';

  let icon = '⚙️';
  let title = `Executed: ${name || 'Tool'}`;
  
  if (isThought) {
    icon = '🧠';
    title = 'Thought Process';
  } else if (isIntent) {
    icon = '🎯';
    title = 'Intent';
  } else if (isSkill) {
    icon = '🧩';
    title = `Executed Skill: ${name || 'Skill'}`;
  }

  const isThoughtOrIntent = isThought || isIntent;

  return (
    <View style={[
      styles.container, 
      { 
        backgroundColor: isThoughtOrIntent ? 'rgba(255, 255, 255, 0.03)' : themeColors.card, 
        borderColor: isThoughtOrIntent ? themeColors.border : accentHex + '33',
        borderStyle: 'solid',
      }
    ]}>
      {/* Header Pressable */}
      <Pressable 
        style={styles.header} 
        onPress={toggleCollapse}
      >
        <View style={styles.headerTextContainer}>
          <Text style={[styles.icon, { fontSize: themeSizes.text }]}>{icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[
              styles.title, 
              { color: themeColors.text, fontSize: themeSizes.text - 1 }
            ]}>
              {title}
            </Text>
            {input ? (
              <Text 
                numberOfLines={1} 
                style={[styles.inputLabel, { color: themeColors.textDark, fontSize: themeSizes.sub }]}
              >
                Args: {input}
              </Text>
            ) : null}
          </View>
        </View>
        <Text style={[styles.arrow, { color: themeColors.textDark, fontSize: themeSizes.text }]}>
          {collapsed ? '▼' : '▲'}
        </Text>
      </Pressable>

      {/* Collapsible Content */}
      {!collapsed && (
        <View style={[
          styles.content, 
          { 
            borderTopColor: themeColors.border,
            backgroundColor: isThoughtOrIntent ? 'transparent' : 'rgba(0, 0, 0, 0.15)'
          }
        ]}>
          {children}
        </View>
      )}
    </View>
  );
```

- [ ] **Step 2: Commit**

```bash
git add client/components/chat/CollapsibleBlock.tsx
git commit -m "feat: support intent and skill types in CollapsibleBlock"
```

---

### Task 4: Integrate in Chat Feed

**Files:**
- Modify: `client/app/index.tsx`

- [ ] **Step 1: Group headers and bubble content**

Update `client/app/index.tsx` to group thought and intent segments as header blocks, and text, tool_calls, and skills as bubble blocks.

Replace lines 367-368:
```typescript
    const headerSegments = segments.filter(s => s.type === 'thought' || s.type === 'intent');
    const bubbleContent = segments.filter(s => s.type !== 'thought' && s.type !== 'intent');
```

- [ ] **Step 2: Update rendering in message feed**

Replace the thought block rendering section (lines 375-394):
```typescript
          {/* Render thought and intent blocks uniquely above the main message bubble */}
          {!isUser && headerSegments.length > 0 && (
            <View style={{ maxWidth: '85%', width: '100%', marginBottom: 6 }}>
              {headerSegments.map((segment, idx) => (
                <CollapsibleBlock
                  key={`${segment.type}-${idx}`}
                  type={segment.type as 'thought' | 'intent'}
                  isClosed={segment.isClosed}
                  themeColors={colors}
                  themeSizes={sizes}
                  accentHex={accentHex}
                >
                  {segment.children && segment.children.length > 0 ? (
                    <View style={{ gap: 4, width: '100%' }}>
                      {segment.children.map((child: any, childIdx: number) => renderSegment(child, childIdx))}
                    </View>
                  ) : null}
                </CollapsibleBlock>
              ))}
            </View>
          )}
```

Also, update `renderSegment` function (lines 326-364):
```typescript
    const renderSegment = (segment: any, idx: number): React.ReactNode => {
      if (segment.type === 'text') {
        return (
          <RichText 
            key={idx}
            content={segment.content || ''} 
            theme={theme}
            fontSize={fontSize}
            accentColor={accentColor}
          />
        );
      } else {
        const hasChildren = segment.children && segment.children.length > 0;
        const isThoughtOrIntent = segment.type === 'thought' || segment.type === 'intent';
        return (
          <CollapsibleBlock
            key={idx}
            type={segment.type}
            name={segment.name}
            input={segment.input}
            isClosed={segment.isClosed}
            themeColors={colors}
            themeSizes={sizes}
            accentHex={accentHex}
          >
            {hasChildren ? (
              <View style={{ gap: 4, width: '100%' }}>
                {segment.children.map((child: any, childIdx: number) => renderSegment(child, childIdx))}
              </View>
            ) : isThoughtOrIntent ? (
              null
            ) : (
              <Text style={[styles.rawText, { color: colors.text, fontSize: sizes.sub, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }]}>
                {segment.type === 'skill' ? '(Executing skill...)' : '(Executing...)'}
              </Text>
            )}
          </CollapsibleBlock>
        );
      }
    };
```

- [ ] **Step 3: Commit**

```bash
git add client/app/index.tsx
git commit -m "feat: integrate intent and skill block rendering in chat feed"
```
