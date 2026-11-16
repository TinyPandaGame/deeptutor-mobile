import { useMemo, useState } from "react";
import { WebView } from "react-native-webview";
import { mathMarkup } from "../lib/math-markup";
import { katexStyle } from "./katex-style";
import { useLearningDisplay } from "../lib/learning-display-context";
import { learningTextStyle } from "../lib/learning-display";
import { useChatBubble } from "../lib/chat-bubble-context";
import { chatLongPressScript } from "../lib/chat-long-press";
export function MathProse({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const bubble = useChatBubble();
  const inChat = !!bubble;
  const { value: display } = useLearningDisplay();
  const { fontSize, lineHeight } = learningTextStyle(display);
  const [height, setHeight] = useState(80);
  const html = useMemo(
    () =>
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; script-src 'nonce-tutor-size'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${katexStyle}html,body{margin:0;padding:0;background:transparent}body{font:${fontSize}px/${lineHeight}px system-ui;color:#183B39;overflow-wrap:anywhere}.katex{font-size:1.1em}.katex-display{overflow-x:auto;overflow-y:hidden;padding:5px 0}#content{padding-bottom:4px}</style></head><body><div id="content">${mathMarkup(text, streaming)}</div><script nonce="tutor-size">function report(){window.ReactNativeWebView.postMessage(String(document.getElementById('content').getBoundingClientRect().height));}new ResizeObserver(report).observe(document.getElementById('content'));document.fonts.ready.then(report);report();</script></body></html>`,
    [text, streaming, fontSize, lineHeight],
  );
  return (
    <WebView
      source={{ html: inChat ? html.replace('</script>', `${chatLongPressScript}</script>`) : html, baseUrl: "about:blank" }}
      style={{ height, backgroundColor: "transparent" }}
      scrollEnabled={false}
      originWhitelist={["about:blank"]}
      onShouldStartLoadWithRequest={(r) => r.url === "about:blank"}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      mixedContentMode="never"
      onMessage={(e) => {
        if (e.nativeEvent.data === 'chat-long-press') { bubble?.(text); return; }
        const n = Number(e.nativeEvent.data);
        if (Number.isFinite(n) && n > 0 && n < 30000)
          setHeight(Math.ceil(n) + 2);
      }}
    />
  );
}
