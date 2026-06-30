import type { WriteHtmlProjectFileInput } from './htmlProjectStore';

const SINGLE_PAGE_TEMPLATE = {
  html: `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HTML Project Canvas</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="app-shell">
      <section class="hero">
        <span class="eyebrow">Canvas MVP</span>
        <h1>開始建立你的第一個互動原型</h1>
        <p>這個專案已經準備好讓模型增量修改。你可以要求重新設計版面、加入區塊或改寫互動。</p>
        <button id="primary-cta">開始編輯</button>
      </section>
    </main>
    <script src="/main.js"></script>
  </body>
</html>`,
  css: `:root {
  color-scheme: dark;
  font-family: Inter, system-ui, sans-serif;
  background: #020617;
  color: #e2e8f0;
}
body {
  margin: 0;
  min-height: 100vh;
  background: radial-gradient(circle at top, #1e293b, #020617 60%);
}
.app-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
}
.hero {
  max-width: 720px;
  padding: 40px;
  border-radius: 24px;
  background: rgba(15, 23, 42, 0.88);
  border: 1px solid rgba(148, 163, 184, 0.2);
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.45);
}
.eyebrow {
  display: inline-flex;
  margin-bottom: 16px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(34, 211, 238, 0.18);
  color: #67e8f9;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
h1 {
  margin: 0 0 16px;
  font-size: clamp(2rem, 4vw, 3.5rem);
}
p {
  margin: 0 0 24px;
  color: #cbd5e1;
  line-height: 1.7;
}
button {
  padding: 14px 20px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, #22d3ee, #3b82f6);
  color: #020617;
  font-weight: 700;
  cursor: pointer;
}
`,
  js: `const button = document.getElementById('primary-cta');
if (button) {
  button.addEventListener('click', () => {
    button.textContent = '已準備好繼續修改';
  });
}
`,
};

export type HtmlProjectTemplate = 'single-page-app' | 'blank';

export const getTemplateFiles = (
  template: HtmlProjectTemplate = 'single-page-app',
): WriteHtmlProjectFileInput[] => {
  if (template === 'blank') {
    return [
      {
        path: '/index.html',
        kind: 'html',
        content:
          '<!doctype html><html><head><meta charset="UTF-8" /><title>Blank Project</title></head><body></body></html>',
      },
    ];
  }

  return [
    { path: '/index.html', kind: 'html', content: SINGLE_PAGE_TEMPLATE.html },
    { path: '/styles.css', kind: 'css', content: SINGLE_PAGE_TEMPLATE.css },
    { path: '/main.js', kind: 'js', content: SINGLE_PAGE_TEMPLATE.js },
  ];
};
