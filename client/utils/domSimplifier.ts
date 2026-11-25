import type { SimplifiedDomNode } from '../store/useDeviceSessionStore';

const SENSITIVE_KEYWORDS = ['password', 'pin', 'otp', 'cvv', 'passcode', 'credential', 'secret'];
const SENSITIVE_PATTERN = /(?:^|[^a-zA-Z0-9])(password|pin|otp|cvv|passcode|credential|secret)(?:[^a-zA-Z0-9]|$)/i;

export function isSensitiveField(text?: string, isPassword?: boolean): boolean {
  if (isPassword) return true;
  if (!text) return false;
  return SENSITIVE_PATTERN.test(text);
}

export function maskSensitiveText(text?: string, isPassword?: boolean): string | undefined {
  if (!text) return text;
  if (isPassword === true) {
    return '••••••••';
  }
  if (isSensitiveField(text)) {
    const lower = text.toLowerCase().trim();
    // Only exempt discrete help/navigation labels if they don't contain any sensitive numbers/codes/OTPs
    const isExemptLabel = (lower === 'forgot password?' || lower === 'forgot password' || lower === 'reset password') && !/\d{3,}/.test(text);
    if (isExemptLabel) {
      return text;
    }
    return '••••••••';
  }
  return text;
}

/**
 * Simplifies a single raw accessibility node into a clean lightweight DOM node.
 */
export function simplifyRawNode(raw: unknown, index: number = 0): SimplifiedDomNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const node = raw as Record<string, any>;

  // Extract type from className or tag
  const className: string = String(node.className || node.type || node.tag || '').toLowerCase();
  let nodeType: SimplifiedDomNode['type'] = 'container';

  if (className.includes('edittext') || className.includes('input') || node.isEditable) {
    nodeType = 'input';
  } else if (className.includes('button') || (node.clickable && (node.text || node.contentDescription))) {
    nodeType = 'button';
  } else if (className.includes('image') || className.includes('icon')) {
    nodeType = 'image';
  } else if (node.text || node.contentDescription) {
    nodeType = 'text';
  }

  // Parse bounds: [left, top, right, bottom]
  let bounds: [number, number, number, number] = [0, 0, 0, 0];
  if (Array.isArray(node.bounds) && node.bounds.length >= 4) {
    bounds = [Number(node.bounds[0]), Number(node.bounds[1]), Number(node.bounds[2]), Number(node.bounds[3])];
  } else if (typeof node.bounds === 'string') {
    // Format: "[left,top][right,bottom]"
    const match = node.bounds.match(/\[(\s*-?\d+(?:\.\d+)?),(\s*-?\d+(?:\.\d+)?)\]\[(\s*-?\d+(?:\.\d+)?),(\s*-?\d+(?:\.\d+)?)\]/);
    if (match) {
      bounds = [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]), parseFloat(match[4])];
    }
  }

  const rawText: string | undefined = node.text || node.contentDescription || undefined;
  const isPassword = Boolean(node.isPassword || node.password);
  const text = maskSensitiveText(rawText, isPassword);

  const id = String(node.id || node.viewIdResourceName || node.ref || `node_${index}`);
  const clickable = Boolean(node.clickable || node.isClickable);

  // Process children
  let children: SimplifiedDomNode[] | undefined;
  if (Array.isArray(node.children) && node.children.length > 0) {
    const simplifiedChildren: SimplifiedDomNode[] = [];
    node.children.forEach((child: unknown, cIdx: number) => {
      const simplified = simplifyRawNode(child, cIdx);
      if (simplified) {
        simplifiedChildren.push(simplified);
      }
    });
    if (simplifiedChildren.length > 0) {
      children = simplifiedChildren;
    }
  }

  return {
    id,
    type: nodeType,
    text,
    bounds,
    clickable,
    isPassword,
    children,
  };
}

/**
 * Parses raw screen hierarchy (stringified JSON, parsed object, or line format) into SimplifiedDomNode[].
 */
export function parseScreenHierarchy(rawHierarchy: string | unknown): SimplifiedDomNode[] {
  if (!rawHierarchy) return [];

  if (typeof rawHierarchy === 'string') {
    const trimmed = rawHierarchy.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return parseScreenHierarchy(parsed);
      } catch {
        // Fallback to text parsing
      }
    }

    // Line-by-line format: supports Android native emitter `[@e0] ClassName: text="..." ...`
    // as well as fallback `@e1: Button 'Submit' [100,200,300,250]`.
    const lines = trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const nodes: SimplifiedDomNode[] = [];

    lines.forEach((line, idx) => {
      // 1. Android native module format: `[@e0] EditText: text="val" desc="desc" bounds=[l,t,r,b]px(...) clickable`
      const nativeMatch = line.match(/^\[(@?\w+)\]\s*([A-Za-z0-9_]+):/);
      if (nativeMatch) {
        const id = nativeMatch[1];
        const className = nativeMatch[2].toLowerCase();
        let type: SimplifiedDomNode['type'] = 'text';
        if (className.includes('button')) type = 'button';
        else if (className.includes('edit') || className.includes('input')) type = 'input';
        else if (className.includes('image')) type = 'image';

        const textMatch = line.match(/text="([^"]*)"/);
        const descMatch = line.match(/desc="([^"]*)"/);
        const rawText = (textMatch && textMatch[1]) || (descMatch && descMatch[1]) || undefined;

        const boundsMatch = line.match(/bounds=\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]/);
        const pxMatch = line.match(/px\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)/);
        const bounds: [number, number, number, number] = boundsMatch
          ? [parseFloat(boundsMatch[1]), parseFloat(boundsMatch[2]), parseFloat(boundsMatch[3]), parseFloat(boundsMatch[4])]
          : pxMatch
          ? [parseFloat(pxMatch[1]), parseFloat(pxMatch[2]), parseFloat(pxMatch[3]), parseFloat(pxMatch[4])]
          : [0, 0, 0, 0];

        const flagsPart = line.includes(')') ? line.slice(line.lastIndexOf(')')) : line;
        const isClickable = flagsPart.includes('clickable') || type === 'button';
        const isPassword = flagsPart.includes('password') || className.includes('password') || (type === 'input' && isSensitiveField(rawText));

        nodes.push({
          id,
          type,
          text: maskSensitiveText(rawText, isPassword),
          bounds,
          clickable: isClickable,
          isPassword,
        });
        return;
      }

      // 2. Legacy fallback format: `@e1: Button 'Submit' [100,200,300,250]`
      const match = line.match(/^(@?\w+)?\s*:?\s*([A-Za-z]+)?\s*(?:'([^']*)')?(?:\s*\[(\s*-?\d+(?:\.\d+)?),(\s*-?\d+(?:\.\d+)?),(\s*-?\d+(?:\.\d+)?),(\s*-?\d+(?:\.\d+)?)\])?/);
      if (match && (match[1] || match[2] || match[3] || match[4])) {
        const id = match[1] || `line_${idx}`;
        const typeStr = (match[2] || '').toLowerCase();
        const rawText = match[3] || undefined;
        const bounds: [number, number, number, number] = [
          parseFloat(match[4] || '0'),
          parseFloat(match[5] || '0'),
          parseFloat(match[6] || '0'),
          parseFloat(match[7] || '0'),
        ];

        let type: SimplifiedDomNode['type'] = 'text';
        if (typeStr.includes('button')) type = 'button';
        else if (typeStr.includes('input') || typeStr.includes('edit')) type = 'input';
        else if (typeStr.includes('image')) type = 'image';

        const isPassword = isSensitiveField(rawText);
        nodes.push({
          id,
          type,
          text: maskSensitiveText(rawText, isPassword),
          bounds,
          clickable: type === 'button',
          isPassword,
        });
      }
    });

    return nodes;
  }

  if (Array.isArray(rawHierarchy)) {
    return rawHierarchy
      .map((item, idx) => simplifyRawNode(item, idx))
      .filter((n): n is SimplifiedDomNode => n !== null);
  }

  const root = simplifyRawNode(rawHierarchy, 0);
  return root ? [root] : [];
}
