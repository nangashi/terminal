---
paths:
  - "src/**/*.{ts,tsx}"
---

## 命令的APIに渡すコールバックは必ずrefパターンを使う

xterm.js の `terminal.onData()` のような命令的API（登録後にReactが再呼び出しできない）にコールバックを渡す場合、propsを直接クロージャに含めず、refを経由して常に最新値を参照する:

```tsx
// ✅ 正しい: refで最新コールバックを参照
const onDataRef = useRef(onData);
onDataRef.current = onData;

useEffect(() => {
  terminal.onData((data) => {
    onDataRef.current?.(data);  // 常に最新
  });
}, []);

// ❌ 間違い: マウント時のonDataを永久捕捉
useEffect(() => {
  terminal.onData((data) => {
    onData?.(data);  // stale closure
  });
}, []);
```
