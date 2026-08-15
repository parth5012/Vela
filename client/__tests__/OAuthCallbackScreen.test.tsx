import React from 'react';
import renderer, { act } from 'react-test-renderer';
import OAuthCallbackScreen from '../components/oauth/OAuthCallbackScreen';

describe('OAuthCallbackScreen', () => {
  const themeColors = {
    background: '#09090b',
    card: '#18181b',
    border: '#27272a',
    text: '#f4f4f5',
    textMuted: '#a1a1aa',
    textDark: '#71717a',
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('should render loading state when status is null', () => {
    let component: any;
    act(() => {
      component = renderer.create(
        <OAuthCallbackScreen
          status={null}
          colors={themeColors}
          accent="#6366f1"
          accentSoft="rgba(99, 102, 241, 0.15)"
        />
      );
    });
    expect(component.toJSON()).toBeDefined();
    const heading = component.root.findByProps({ children: 'Checking authorization…' });
    expect(heading).toBeDefined();
  });

  it('should render success state when status is success', () => {
    const account = {
      name: 'Test Member',
      email: 'test@example.com',
    };
    let component: any;
    act(() => {
      component = renderer.create(
        <OAuthCallbackScreen
          status="success"
          account={account}
          colors={themeColors}
          accent="#6366f1"
          accentSoft="rgba(99, 102, 241, 0.15)"
        />
      );
    });
    const heading = component.root.findByProps({ accessibilityRole: 'header' });
    expect(heading.props.children).toContain('Authorized successfully');
    
    const emailNode = component.root.findByProps({ children: 'test@example.com' });
    expect(emailNode).toBeDefined();
  });

  it('should render error state when status is error', () => {
    let component: any;
    act(() => {
      component = renderer.create(
        <OAuthCallbackScreen
          status="error"
          message="Invalid credentials"
          colors={themeColors}
          accent="#6366f1"
          accentSoft="rgba(99, 102, 241, 0.15)"
        />
      );
    });
    const heading = component.root.findByProps({ accessibilityRole: 'alert' });
    expect(heading.props.children).toContain('Authorization failed');
    
    const errorNode = component.root.findByProps({ children: 'Invalid credentials' });
    expect(errorNode).toBeDefined();
  });
});
