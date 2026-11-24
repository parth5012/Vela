import {
  parseScreenHierarchy,
  simplifyRawNode,
  maskSensitiveText,
  isSensitiveField,
} from '../utils/domSimplifier';

describe('domSimplifier', () => {
  describe('maskSensitiveText and isSensitiveField', () => {
    it('detects sensitive password, pin, and otp fields', () => {
      expect(isSensitiveField('Enter password')).toBe(true);
      expect(isSensitiveField('Your PIN number')).toBe(true);
      expect(isSensitiveField('SMS OTP code')).toBe(true);
      expect(isSensitiveField(undefined, true)).toBe(true);
      expect(isSensitiveField('General Settings')).toBe(false);
    });

    it('masks sensitive text with bullets', () => {
      expect(maskSensitiveText('my_secret_password', true)).toBe('••••••••');
      expect(maskSensitiveText('Your OTP is 123456')).toBe('••••••••');
      expect(maskSensitiveText('Welcome back, Alice')).toBe('Welcome back, Alice');
      expect(maskSensitiveText(undefined)).toBeUndefined();
    });
  });

  describe('simplifyRawNode', () => {
    it('simplifies raw android node into typed lightweight DOM node', () => {
      const raw = {
        className: 'android.widget.Button',
        text: 'Submit Order',
        bounds: [100, 200, 400, 280],
        clickable: true,
      };

      const simplified = simplifyRawNode(raw);
      expect(simplified).not.toBeNull();
      expect(simplified?.type).toBe('button');
      expect(simplified?.text).toBe('Submit Order');
      expect(simplified?.bounds).toEqual([100, 200, 400, 280]);
      expect(simplified?.clickable).toBe(true);
    });

    it('masks password input fields', () => {
      const raw = {
        className: 'android.widget.EditText',
        text: 'secret_val',
        isPassword: true,
        bounds: '[0,0][100,50]',
        clickable: true,
      };

      const simplified = simplifyRawNode(raw);
      expect(simplified?.type).toBe('input');
      expect(simplified?.text).toBe('••••••••');
      expect(simplified?.isPassword).toBe(true);
      expect(simplified?.bounds).toEqual([0, 0, 100, 50]);
    });
  });

  describe('parseScreenHierarchy', () => {
    it('parses JSON stringified hierarchy', () => {
      const json = JSON.stringify([
        {
          id: 'card_1',
          className: 'ViewGroup',
          bounds: [0, 0, 500, 500],
          children: [
            { id: 'btn_1', className: 'Button', text: 'Confirm', bounds: [10, 10, 200, 80], clickable: true },
          ],
        },
      ]);

      const result = parseScreenHierarchy(json);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('card_1');
      expect(result[0].children?.length).toBe(1);
      expect(result[0].children?.[0].type).toBe('button');
      expect(result[0].children?.[0].text).toBe('Confirm');
    });

    it('parses line-by-line fallback text representation', () => {
      const text = `
        @e0: Button 'Login' [50,100,300,160]
        @e1: Input 'password_field' [50,180,300,240]
      `;

      const result = parseScreenHierarchy(text);
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('@e0');
      expect(result[0].type).toBe('button');
      expect(result[0].text).toBe('Login');
      expect(result[0].bounds).toEqual([50, 100, 300, 160]);

      expect(result[1].id).toBe('@e1');
      expect(result[1].type).toBe('input');
      expect(result[1].text).toBe('••••••••');
    });

    it('returns empty array on empty input', () => {
      expect(parseScreenHierarchy('')).toEqual([]);
      expect(parseScreenHierarchy(null)).toEqual([]);
    });
  });
});
