# Expo Client WebView Integration

The frontend client leverages `react-native-webview` to render the browser environment. The interface is split, presenting the chat thread on the top half and the live automation viewport on the bottom half when a browser session is active.

## Code Integration Details

### 1. Component State & Refs
Inside `app/index.tsx`, we maintain state variables to handle viewport visibility and execution handoffs:

```typescript
const [webviewUrl, setWebviewUrl] = useState('about:blank');
const [showWebview, setShowWebview] = useState(false);
const [isWebviewLoading, setIsWebviewLoading] = useState(false);
const [pendingAction, setPendingAction] = useState<any>(null);
const [lastExecutedId, setLastExecutedId] = useState<string | null>(null);
const webViewRef = React.useRef<any>(null);
```

### 2. Stream Interception Logic
A `useEffect` listener processes streaming messages to detect the custom tool tag:

```typescript
const lastMsg = activeMessages[activeMessages.length - 1];

React.useEffect(() => {
  if (!lastMsg || lastMsg.role !== 'assistant' || !activeThreadId) return;

  // Match the webview_browser call tag in the streaming content
  const regex = /<call:webview_browser\s+input="((?:[^"\\]|\\.)*)"\s*>/g;
  let match;
  let lastMatch = null;
  
  while ((match = regex.exec(lastMsg.content)) !== null) {
    lastMatch = match;
  }

  if (lastMatch) {
    const rawInput = lastMatch[1];
    const executionId = `${lastMsg.id}_${lastMatch.index}`;
    
    if (lastExecutedId !== executionId) {
      setLastExecutedId(executionId);
      
      try {
        const unescaped = rawInput.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        const parsedInput = JSON.parse(unescaped);
        handleWebviewAction(parsedInput);
      } catch (e) {
        console.error("Failed to parse webview_browser input:", e);
      }
    }
  }
}, [lastMsg?.content, activeThreadId, lastExecutedId, handleWebviewAction]);
```

---

## Command Dispatcher

When `handleWebviewAction` is called, it branches execution based on the action parameter:

```typescript
const handleWebviewAction = useCallback(async (input: { conversation_id: string; action: string; target?: string; value?: string }) => {
  setShowWebview(true);
  
  if (input.action === 'navigate' && input.value) {
    setIsWebviewLoading(true);
    setWebviewUrl(input.value);
    setPendingAction({
      conversation_id: input.conversation_id,
      action: 'navigate',
      value: input.value
    });
  } else {
    setPendingAction({
      conversation_id: input.conversation_id,
      action: input.action,
      target: input.target,
      value: input.value
    });
    // Brief delay to allow the WebView viewport component to mount if hidden
    setTimeout(() => {
      executeScriptForAction(input.action, input.target, input.value);
    }, 300);
  }
}, [executeScriptForAction]);
```

---

## Handling WebView Callback Events

Communication back to React Native is handled via the `onMessage` handler of the WebView component:

* **Navigation**: When the page finishes loading, `onLoadEnd` fires. If the pending action is `navigate`, it sends a success status back to FastAPI.
* **Script Injection**: Script results (such as extracted DOM elements or click confirmations) are posted using `window.ReactNativeWebView.postMessage()` and parsed inside `onMessage`:

```typescript
const handleWebViewMessage = useCallback((event: any) => {
  try {
    const response = JSON.parse(event.nativeEvent.data);
    if (!pendingAction) return;

    if (response.type === 'dom_extracted') {
      sendWebviewResponseToBackend(pendingAction.conversation_id, 'success', JSON.stringify(response.data));
      setPendingAction(null);
    } else if (response.type === 'click_success' || response.type === 'fill_success') {
      sendWebviewResponseToBackend(pendingAction.conversation_id, 'success', response.data);
      setPendingAction(null);
    } else if (response.type === 'error') {
      sendWebviewResponseToBackend(pendingAction.conversation_id, 'error', response.data);
      setPendingAction(null);
    }
  } catch (e) {
    console.error("Failed to parse webview message:", e);
    if (pendingAction) {
      sendWebviewResponseToBackend(pendingAction.conversation_id, 'error', 'Invalid message format from WebView');
      setPendingAction(null);
    }
  }
}, [pendingAction, sendWebviewResponseToBackend]);
```
