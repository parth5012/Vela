export interface MessageSegment {
  type: 'text' | 'thought' | 'tool_call' | 'intent' | 'skill';
  content?: string;
  name?: string;
  input?: string;
  isClosed: boolean;
  children?: MessageSegment[];
  /**
   * #160: Optional policy tier for tool_call pills. Not populated by the
   * parser itself; renderSegment derives it from the safety policy unless a
   * caller supplied one explicitly.
   */
  safetyTier?: 'auto' | 'ask' | 'blocked';
}

/**
 * FIX-1: caps so unclosed / giant tool-call payloads can't freeze the chat.
 * MAX_NESTING bounds `<call:>`/`<skill:>` node depth (deeper tags become
 * literal text); MAX_INPUT_LENGTH bounds captured `input` per node.
 */
export const MAX_NESTING = 5;
export const MAX_INPUT_LENGTH = 2000;

function truncateInput(val: string | undefined): string | undefined {
  if (!val) return val;
  if (val.length > MAX_INPUT_LENGTH) return val.slice(0, MAX_INPUT_LENGTH) + '... truncated';
  return val;
}

/**
 * Whether a segment carries enough information to be worth rendering.
 *
 * Only tool_call/skill segments can be "empty" (no name, no input, no content,
 * no children); those render as phantom "Executed: Tool" / "Executing: Skill"
 * collapsibles (#150). Every other segment type is always renderable.
 */
export function hasRenderableContent(segment: MessageSegment): boolean {
  if (segment.type !== 'tool_call' && segment.type !== 'skill') return true;
  if (segment.name || segment.input || segment.content) return true;
  return Array.isArray(segment.children) && segment.children.length > 0;
}

/**
 * Post-parse sweep: drop CLOSED tool_call/skill segments that carry no data.
 * Open (mid-stream) segments are always kept - they are awaiting content.
 */
function pruneEmptyClosedSegments(segments: MessageSegment[]): MessageSegment[] {
  const pruned: MessageSegment[] = [];
  for (const segment of segments) {
    const isEmptyClosedBlock =
      (segment.type === 'tool_call' || segment.type === 'skill') &&
      segment.isClosed &&
      !hasRenderableContent(segment);
    if (isEmptyClosedBlock) continue;
    if (segment.children && segment.children.length > 0) {
      segment.children = pruneEmptyClosedSegments(segment.children);
    }
    pruned.push(segment);
  }
  return pruned;
}

// Tag shapes for <call:...> and <skill:...>; the parse logic is identical
// apart from the tag name and resulting segment type.
const CALL_OPEN_REGEX = /^<call:([a-zA-Z0-9_:]+)(?:\s+input=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'))?\s*>/;
const CALL_NAME_REGEX = /^<call:([a-zA-Z0-9_:]*)/;
const SKILL_OPEN_REGEX = /^<skill:([a-zA-Z0-9_:]+)(?:\s+input=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'))?\s*>/;
const SKILL_NAME_REGEX = /^<skill:([a-zA-Z0-9_:]*)/;

export function parseMessage(content: string): MessageSegment[] {
  if (typeof content !== 'string') return [];
  const root: MessageSegment = {
    type: 'text',
    isClosed: true,
    children: [],
  };

  const stack: MessageSegment[] = [root];
  let index = 0;

  const activeNode = () => stack[stack.length - 1];

  // FIX: nesting cap counts only open tool_call/skill nodes. The root stack
  // entry is type 'text', so pure tool nesting counts are unchanged, while
  // <thought>/<intent> wrappers no longer consume the tool budget.
  const openToolDepth = () =>
    stack.filter((s) => s.type === 'tool_call' || s.type === 'skill').length;

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

  // Shared <call:...>/<skill:...> open-tag handling. Returns whether the
  // caller should break out of the parse loop, continue it, or fall through.
  const handleNamedTagOpen = (
    openTagRegex: RegExp,
    nameRegex: RegExp,
    bareMarker: string,
    segmentType: 'tool_call' | 'skill'
  ): 'break' | 'continue' | 'next' => {
    const remaining = content.slice(index);
    const openTagMatch = remaining.match(openTagRegex);

    if (!openTagMatch) {
      const nameMatch = remaining.match(nameRegex);
      const name = nameMatch ? nameMatch[1] : '';

      if (!name) {
        // Bare marker fragment (e.g. '<call:>' or a stray marker in prose).
        // Emit it as literal text instead of fabricating a nameless node
        // that renders a phantom block (#150).
        addText(bareMarker);
        index += bareMarker.length;
        return 'continue';
      }

      let input: string | undefined = undefined;
      const inputMatch = remaining.match(/input=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/);
      if (inputMatch) {
        input = inputMatch[1] !== undefined ? inputMatch[1] : inputMatch[2];
      } else {
        const partialInputMatch = remaining.match(/input=["']((?:[^"\\]|\\.)*)$/);
        if (partialInputMatch) {
          input = partialInputMatch[1];
        }
      }

      if (openToolDepth() >= MAX_NESTING) {
        // FIX-1: nesting cap reached — emit the raw tag as literal text
        // instead of pushing another node, then stop parsing.
        addText(remaining);
        return 'break';
      }

      const newNode: MessageSegment = {
        type: segmentType,
        name,
        isClosed: false,
        children: [],
      };
      if (input !== undefined) {
        newNode.input = truncateInput(input);
      }
      activeNode().children!.push(newNode);
      stack.push(newNode);
      return 'break';
    }

    const tagName = openTagMatch[1];
    const inputVal = openTagMatch[2] !== undefined ? openTagMatch[2] : openTagMatch[3];
    index += openTagMatch[0].length;

    if (openToolDepth() >= MAX_NESTING) {
      // FIX-1: nesting cap reached — emit the raw tag as literal text
      // instead of pushing another node.
      addText(openTagMatch[0]);
      return 'continue';
    }

    const newNode: MessageSegment = {
      type: segmentType,
      name: tagName,
      isClosed: false,
      children: [],
    };
    if (inputVal !== undefined) {
      newNode.input = truncateInput(inputVal);
    }
    activeNode().children!.push(newNode);
    stack.push(newNode);
    return 'next';
  };

  // Shared </call...>/</skill...> close-tag handling.
  const handleNamedTagClose = (segmentType: 'tool_call' | 'skill'): void => {
    const closeRemaining = content.slice(index);
    const closeTagEndIdx = closeRemaining.indexOf('>');

    if (closeTagEndIdx === -1) {
      index = content.length;
    } else {
      index += closeTagEndIdx + 1;
      if (stack.length > 1 && stack[stack.length - 1].type === segmentType) {
        const popped = stack.pop()!;
        popped.isClosed = true;
      }
    }
  };

  while (index < content.length) {
    const textRemaining = content.slice(index);

    const nextThoughtOpen = textRemaining.indexOf('<thought>');
    const nextThoughtClose = textRemaining.indexOf('</thought>');
    const nextCallOpen = textRemaining.indexOf('<call:');
    const nextCallClose = textRemaining.indexOf('</call');
    const nextIntentOpen = textRemaining.indexOf('<intent>');
    const nextIntentClose = textRemaining.indexOf('</intent>');
    const nextSkillOpen = textRemaining.indexOf('<skill:');
    const nextSkillClose = textRemaining.indexOf('</skill');

    const targets: {
      pos: number;
      type: 'thought_open' | 'thought_close' | 'call_open' | 'call_close' | 'intent_open' | 'intent_close' | 'skill_open' | 'skill_close';
    }[] = [];
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
    else if (nextTarget.type === 'call_open' || nextTarget.type === 'skill_open') {
      const isCall = nextTarget.type === 'call_open';
      const outcome = handleNamedTagOpen(
        isCall ? CALL_OPEN_REGEX : SKILL_OPEN_REGEX,
        isCall ? CALL_NAME_REGEX : SKILL_NAME_REGEX,
        isCall ? '<call:' : '<skill:',
        isCall ? 'tool_call' : 'skill'
      );
      if (outcome === 'break') break;
      if (outcome === 'continue') continue;
    }
    else if (nextTarget.type === 'call_close' || nextTarget.type === 'skill_close') {
      handleNamedTagClose(nextTarget.type === 'call_close' ? 'tool_call' : 'skill');
    }
  }

  // Post-parse sweep (#150): never let a closed, data-less tool_call/skill
  // segment reach the UI. Open segments awaiting stream content are kept.
  return pruneEmptyClosedSegments(root.children || []);
}
