import {
  parseScreenHierarchy,
  simplifyRawNode,
  maskSensitiveText,
  isSensitiveField,
} from '../utils/domSimplifier';

describe('domSimplifier', () => {
  describe('maskSensitiveText and isSensitiveField', () => {
    it('detects sensitive password, pin, and otp fields with word boundaries', () => {
      expect(isSensitiveField('Enter password')).toBe(true);
      expect(isSensitiveField('Your PIN number')).toBe(true);
      expect(isSensitiveField('SMS OTP code')).toBe(true);
      expect(isSensitiveField(undefined, true)).toBe(true);
      expect(isSensitiveField('General Settings')).toBe(false);
      expect(isSensitiveField('Loading Spinner')).toBe(false);
      expect(isSensitiveField('Pinned message')).toBe(false);
      expect(isSensitiveField('Pinterest board')).toBe(false);
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

    it('parses real Android native module indented line format with bounds and masking', () => {
      const nativeOutput = `
  [@e0] EditText: text="secret_pin_123" desc="" bounds=[10,20,30,40]px(108,480,972,720) clickable focused
  [@e1] Button: text="Submit Now" desc="" bounds=[10,50,90,60]px(108,1200,972,1440) clickable
  [@e2] TextView: text="Forgot password?" desc="" bounds=[20,70,80,80]px(216,1680,864,1920) clickable
`;

      const result = parseScreenHierarchy(nativeOutput);
      expect(result.length).toBe(3);

      expect(result[0].id).toBe('@e0');
      expect(result[0].type).toBe('input');
      expect(result[0].text).toBe('••••••••');
      expect(result[0].bounds).toEqual([10, 20, 30, 40]);
      expect(result[0].clickable).toBe(true);
      expect(result[0].isPassword).toBe(true);

      expect(result[1].id).toBe('@e1');
      expect(result[1].type).toBe('button');
      expect(result[1].text).toBe('Submit Now');
      expect(result[1].bounds).toEqual([10, 50, 90, 60]);
      expect(result[1].clickable).toBe(true);

      expect(result[2].id).toBe('@e2');
      expect(result[2].type).toBe('text');
      expect(result[2].text).toBe('Forgot password?');
      expect(result[2].bounds).toEqual([20, 70, 80, 80]);
    });

    it('parses negative off-screen coordinates in bounds and px formats', () => {
      const output = `
        [@e0] View: text="Offscreen Header" bounds=[-10,-20,100,50]px(-10,-20,100,50)
      `;
      const result = parseScreenHierarchy(output);
      expect(result.length).toBe(1);
      expect(result[0].bounds).toEqual([-10, -20, 100, 50]);
    });

    it('returns empty array on empty input', () => {
      expect(parseScreenHierarchy('')).toEqual([]);
      expect(parseScreenHierarchy(null)).toEqual([]);
    });
  });
});
