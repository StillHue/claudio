import * as vscode from 'vscode'

const TERMINAL_NAME = 'OpenClaude'

export function activate(context: vscode.ExtensionContext): void {
  // Sidebar view exists only to give OpenClaude an Activity Bar icon.
  // Clicking it opens the CLI as a full editor tab (OpenCode style).
  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView(view: vscode.WebviewView) {
      view.webview.options = { enableScripts: true }
      view.webview.html = getSidebarHtml()
      view.webview.onDidReceiveMessage((msg) => {
        if (msg?.type === 'open') openInEditorTab(context)
      })
      // Auto-open on first reveal, like OpenCode.
      openInEditorTab(context)
    },
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('openclaude.sidebar', provider),
    vscode.commands.registerCommand('openclaude.open', () => openInEditorTab(context)),
    vscode.commands.registerCommand('openclaude.openEditor', () => openInEditorTab(context)),
    vscode.commands.registerCommand('openclaude.restart', () => {
      const existing = vscode.window.terminals.find(t => t.name === TERMINAL_NAME)
      existing?.dispose()
      openInEditorTab(context)
    }),
  )
}

export function deactivate(): void {}

/** Run the OpenClaude CLI in a terminal editor tab (full main-area screen). */
function openInEditorTab(context: vscode.ExtensionContext): void {
  const existing = vscode.window.terminals.find(t => t.name === TERMINAL_NAME)
  if (existing) {
    existing.show()
    return
  }

  const config = vscode.workspace.getConfiguration('openclaude')
  const command = config.get<string>('command') || 'openclaude'
  const args = config.get<string[]>('args') || []
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

  const term = vscode.window.createTerminal({
    name: TERMINAL_NAME,
    cwd,
    location: vscode.TerminalLocation.Editor,
    iconPath: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon-mono.svg'),
  })
  term.show()
  term.sendText([command, ...args].join(' '), true)
}

function getSidebarHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 90vh;
    gap: 14px;
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
  }
  .mark { font-size: 42px; color: #d97757; }
  button {
    background: #d97757;
    color: #1e1e1e;
    border: none;
    border-radius: 6px;
    padding: 8px 18px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { background: #e08a6a; }
  p { opacity: 0.7; font-size: 12px; text-align: center; max-width: 200px; }
</style>
</head>
<body>
  <div class="mark">✳</div>
  <button id="open">Open OpenClaude</button>
  <p>Opens the CLI in a full editor tab</p>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('open').addEventListener('click', () => {
      vscode.postMessage({ type: 'open' });
    });
  </script>
</body>
</html>`
}
