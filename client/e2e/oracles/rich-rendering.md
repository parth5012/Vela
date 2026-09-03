# Rich Rendering Oracle (E4)

## Pass Criteria

| Step | Action | Expected State | ADB Command | Tolerance |
|------|--------|---------------|-------------|-----------|
| 1 | Render Markdown Message | Headings, bold, lists rendered | `uiautomator dump` + grep rendered content | 3s |
| 2 | Render Code Block | Code block with syntax highlighting container | `screencap` / `uiautomator dump` | 3s |
| 3 | Render LaTeX / Formula | Math formulas extracted and parsed | `uiautomator dump` + verify formula | 3s |
| 4 | Render Mermaid Diagram | Mermaid chart container rendered without error | `screencap` / `uiautomator dump` | 3s |

## Fail Conditions

- Raw unparsed markdown tags or unhealed XML leaking into UI
- Hermes/WebView crash during math or diagram rendering
- Logcat error in `latexExtractor` or `MermaidRenderer`
