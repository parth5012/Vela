# Local DOM Minification & Token Savings

To make the agent's web browsing cost-efficient, the raw HTML DOM must be minified before sending it to the LLM. 

An average webpage can exceed **100,000 tokens** when sent raw, costing roughly **$0.20 per call** and quickly filling the LLM context window.

## The Minification Algorithm

Vela uses a local minifier script injected into the WebView. The script runs on the client's phone CPU, extracting only interactive elements. This reduces token consumption to **~300 - 800 tokens** (a 99% reduction).

The injected script:
1. Queries critical element nodes (`button`, `a`, `input`, `textarea`, `select`, `[role="button"]`, and structural headings `h1`, `h2`, `h3`).
2. Iterates over elements and inspects their layout properties via the browser engine. It filters out elements with zero dimensions, display properties set to `none`, visibility set to `hidden`, or opacity set to `0`.
3. Assigns a unique tracking index (`data-vela-id="eX"`) to each matching element in the DOM. This allows the backend agent to reference them later (e.g. `@e0`, `@e1`) instead of writing long CSS paths.
4. Compiles a JSON object containing the ID, HTML tag, input type, truncated visible text, element title, and placeholder text.
5. Emits the JSON back to the app via `postMessage()`.

---

## Minification Script (JavaScript)

This script is injected during the `extract_dom` tool action:

```javascript
(function() {
  try {
    var elements = document.querySelectorAll('button, a, input, textarea, select, [role="button"], h1, h2, h3');
    var results = [];
    var counter = 0;
    
    elements.forEach(function(el) {
      // Filter out hidden or collapsed elements
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

      // Assign a temporary unique ID
      var refId = 'e' + counter++;
      el.setAttribute('data-vela-id', refId);

      // Extract text content and truncate if excessively long
      var text = (el.innerText || el.placeholder || el.value || '').trim();
      if (text.length > 100) {
        text = text.substring(0, 100) + '...';
      }

      results.push({
        id: '@' + refId,
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        text: text,
        title: el.title || '',
        placeholder: el.placeholder || ''
      });
    });
    
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'dom_extracted',
      data: results
    }));
  } catch(e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'error',
      data: e.message
    }));
  }
})();
```

---

## Action Injections (Click & Fill)

When the agent wants to click an element or input text, it references the assigned ID (e.g., target: `@e3`). The client translates this by locating the matching `data-vela-id` attribute:

### Click Script
```javascript
(function() {
  try {
    var el = document.querySelector('[data-vela-id="' + targetId + '"]');
    if (el) {
      el.click();
      window.ReactNativeWebView.postMessage(JSON.stringify({type: 'click_success', data: 'Successfully clicked element'}));
    } else {
      window.ReactNativeWebView.postMessage(JSON.stringify({type: 'error', data: 'Element not found'}));
    }
  } catch(e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({type: 'error', data: e.message}));
  }
})();
```

### Fill Script
```javascript
(function() {
  try {
    var el = document.querySelector('[data-vela-id="' + targetId + '"]');
    if (el) {
      el.focus();
      el.value = escapedValue;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      window.ReactNativeWebView.postMessage(JSON.stringify({type: 'fill_success', data: 'Successfully filled element'}));
    } else {
      window.ReactNativeWebView.postMessage(JSON.stringify({type: 'error', data: 'Element not found'}));
    }
  } catch(e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({type: 'error', data: e.message}));
  }
})();
```
