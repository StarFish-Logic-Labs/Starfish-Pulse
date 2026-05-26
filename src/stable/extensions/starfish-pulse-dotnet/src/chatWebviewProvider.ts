import * as vscode from 'vscode';
import { OllamaClient, ChatMessage } from './ollamaClient';
import { ContextManager } from './contextManager';
import { N8nClient } from './n8nClient';

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'starfish-pulse-chat-view';

  private _view?: vscode.WebviewView;
  private _chatHistory: ChatMessage[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _ollamaClient: OllamaClient,
    private readonly _contextManager: ContextManager,
    private readonly _n8nClient: N8nClient
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'sendMessage':
          await this._handleSendMessage(data.text);
          break;
        case 'resetChat':
          this.clearChat();
          break;
        case 'runCommand':
          vscode.commands.executeCommand(data.command);
          break;
        case 'triggerN8n':
          await this._handleTriggerN8n(data.prompt);
          break;
        case 'checkModels':
          await this._updateAvailableModels();
          break;
      }
    });

    // Check available models on load
    this._updateAvailableModels();
  }

  public clearChat() {
    this._chatHistory = [];
    this._view?.webview.postMessage({ type: 'chatCleared' });
  }

  public async insertPrompt(promptText: string, submitImmediately = false) {
    this._view?.webview.postMessage({
      type: 'insertPrompt',
      text: promptText,
      submit: submitImmediately
    });
  }

  private async _updateAvailableModels() {
    try {
      const models = await this._ollamaClient.getAvailableModels();
      const config = vscode.workspace.getConfiguration('starfish');
      const activeModel = config.get<string>('ollamaModel', 'qwen2.5-coder:14b');
      this._view?.webview.postMessage({
        type: 'modelsUpdated',
        models,
        activeModel
      });
    } catch (e) {
      console.error('Failed to get models:', e);
    }
  }

  private async _handleSendMessage(userMessage: string) {
    if (!this._view) return;

    // Add user message to history
    const userMsgObj: ChatMessage = { role: 'user', content: userMessage };
    this._chatHistory.push(userMsgObj);

    // Update UI with user message
    this._view.webview.postMessage({
      type: 'addUserMessage',
      text: userMessage
    });

    // Start streaming assistant response
    this._view.webview.postMessage({ type: 'startStreaming' });

    try {
      // Fetch workspace context to append to the system prompt dynamically if needed
      const projectContext = await this._contextManager.getWorkspaceContext();
      const formattedContext = this._contextManager.formatContextPrompt(projectContext);
      
      const systemPromptOverride = vscode.workspace.getConfiguration('starfish').get<string>('systemPrompt', '') +
        `\n\nHere is the current workspace context:\n${formattedContext}`;

      let assistantResponse = '';
      
      for await (const chunk of this._ollamaClient.streamChat(this._chatHistory, systemPromptOverride)) {
        assistantResponse += chunk;
        this._view.webview.postMessage({
          type: 'streamChunk',
          chunk: chunk
        });
      }

      // Add assistant response to history
      this._chatHistory.push({ role: 'assistant', content: assistantResponse });
      this._view.webview.postMessage({ type: 'stopStreaming' });
    } catch (error: any) {
      console.error('Ollama Chat Error:', error);
      this._view.webview.postMessage({
        type: 'error',
        message: `Ollama Error: ${error.message || error}`
      });
      this._view.webview.postMessage({ type: 'stopStreaming' });
    }
  }

  private async _handleTriggerN8n(prompt: string) {
    if (!this._view) return;

    this._view.webview.postMessage({
      type: 'addSystemMessage',
      text: 'Triggering hosted n8n workflow...'
    });

    try {
      const projectContext = await this._contextManager.getWorkspaceContext();
      const result = await this._n8nClient.triggerWorkflow('chat_command', projectContext, { prompt });
      
      this._view.webview.postMessage({
        type: 'addAssistantMessage',
        text: result.message || JSON.stringify(result, null, 2)
      });
    } catch (error: any) {
      this._view.webview.postMessage({
        type: 'error',
        message: `n8n Error: ${error.message || error}`
      });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com; connect-src ${cspSource} http://localhost:11434 https://ollama.peweez.cloud https://n8n.peweez.cloud; img-src ${cspSource} data:;">
  
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Outfit:wght@400;600&display=swap" rel="stylesheet">
  <!-- Marked Markdown Parser -->
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <!-- Prism.js Code Highlighting CSS & JS -->
  <link href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet" />
  <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-core.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>

  <style>
    :root {
      --bg-gradient: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
      --glass-bg: rgba(30, 41, 59, 0.45);
      --glass-border: rgba(255, 255, 255, 0.08);
      --glass-hover: rgba(255, 255, 255, 0.12);
      
      --accent-primary: #8b5cf6;
      --accent-secondary: #3b82f6;
      --accent-glow: rgba(139, 92, 246, 0.3);
      
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      
      --shadow-soft: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
    }

    body {
      background: var(--bg-gradient);
      color: var(--text-main);
      font-family: 'Inter', sans-serif;
      margin: 0;
      padding: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    #chat-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 16px;
      overflow-y: auto;
      gap: 16px;
      padding-bottom: 90px; /* Space for absolute floating input */
    }

    /* Welcome view inside chat */
    .welcome-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      margin-top: 20px;
      gap: 10px;
      animation: fadeIn 0.6s ease-out;
    }

    .welcome-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.5rem;
      font-weight: 600;
      background: linear-gradient(to right, #a78bfa, #60a5fa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .welcome-subtitle {
      font-size: 0.85rem;
      color: var(--text-muted);
      max-width: 280px;
    }

    /* Glassmorphic cards for quick action chips */
    .chips-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      width: 100%;
      margin-top: 15px;
    }

    .action-chip {
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      padding: 12px;
      font-size: 0.75rem;
      cursor: pointer;
      text-align: left;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(8px);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .action-chip:hover {
      background: var(--glass-hover);
      border-color: var(--accent-primary);
      box-shadow: 0 0 12px var(--accent-glow);
      transform: translateY(-2px);
    }

    .chip-title {
      font-weight: 600;
      color: var(--text-main);
    }

    .chip-desc {
      color: var(--text-muted);
      font-size: 0.65rem;
    }

    /* Message bubbles */
    .message {
      max-width: 85%;
      padding: 12px 16px;
      border-radius: 16px;
      font-size: 0.85rem;
      line-height: 1.45;
      animation: messageSlideIn 0.3s ease-out;
      backdrop-filter: blur(8px);
      word-wrap: break-word;
    }

    .message.user {
      align-self: flex-end;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.45) 0%, rgba(59, 130, 246, 0.45) 100%);
      border: 1px solid rgba(139, 92, 246, 0.3);
      border-bottom-right-radius: 4px;
      box-shadow: 0 4px 15px rgba(139, 92, 246, 0.15);
    }

    .message.assistant {
      align-self: flex-start;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-bottom-left-radius: 4px;
    }

    .message.system {
      align-self: center;
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid var(--glass-border);
      color: var(--text-muted);
      font-size: 0.75rem;
      border-radius: 20px;
      padding: 6px 14px;
      text-align: center;
    }

    .message pre {
      background: rgba(15, 23, 42, 0.8) !important;
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      padding: 10px;
      overflow-x: auto;
      margin: 8px 0;
    }

    .message code {
      font-family: 'Consolas', 'Courier New', Courier, monospace;
      font-size: 0.8rem;
    }

    /* Status & Models Info Panel */
    .status-panel {
      background: rgba(15, 23, 42, 0.6);
      border-bottom: 1px solid var(--glass-border);
      padding: 8px 16px;
      font-size: 0.75rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      backdrop-filter: blur(12px);
      z-index: 10;
    }

    .model-selector {
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-main);
      border-radius: 6px;
      padding: 2px 6px;
      font-size: 0.7rem;
      outline: none;
    }

    /* Floating input container */
    .input-container {
      position: absolute;
      bottom: 16px;
      left: 16px;
      right: 16px;
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      display: flex;
      align-items: center;
      padding: 8px 12px;
      backdrop-filter: blur(20px);
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
      transition: border-color 0.3s;
    }

    .input-container:focus-within {
      border-color: var(--accent-primary);
      box-shadow: 0 0 15px var(--accent-glow);
    }

    .chat-input {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--text-main);
      font-family: inherit;
      font-size: 0.85rem;
      outline: none;
      resize: none;
      max-height: 100px;
      padding: 4px;
    }

    .send-btn {
      background: var(--accent-primary);
      border: none;
      color: white;
      border-radius: 12px;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.2s, background-color 0.2s;
    }

    .send-btn:hover {
      background: #7c3aed;
      transform: scale(1.05);
    }

    /* Streaming dot loader */
    .typing-indicator {
      display: flex;
      gap: 4px;
      padding: 4px;
      align-items: center;
    }

    .typing-dot {
      width: 6px;
      height: 6px;
      background: var(--text-muted);
      border-radius: 50%;
      animation: typingBounce 1.4s infinite ease-in-out both;
    }

    .typing-dot:nth-child(1) { animation-delay: -0.32s; }
    .typing-dot:nth-child(2) { animation-delay: -0.16s; }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes messageSlideIn {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes typingBounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }
  </style>
</head>
<body>

  <div class="status-panel">
    <div>
      Status: <span style="color: #10b981; font-weight:600;">Ollama Connected</span>
    </div>
    <div>
      Model: 
      <select id="model-select" class="model-selector" disabled>
        <option id="active-model-opt">Loading...</option>
      </select>
    </div>
  </div>

  <div id="chat-container">
    <div id="welcome-view" class="welcome-container">
      <div class="welcome-title">Starfish Pulse</div>
      <div class="welcome-subtitle">Your C# &amp; .NET AI Assistant, developed by Jan Jalinski (Starfish Logic Labs). Ask me anything, or trigger quick actions.</div>
      
      <div class="chips-grid">
        <button class="action-chip" onclick="runVSCodeCommand('starfish.explainCode')">
          <span class="chip-title">💡 Explain Code</span>
          <span class="chip-desc">Explain the currently selected C# code</span>
        </button>
        <button class="action-chip" onclick="runVSCodeCommand('starfish.generateTests')">
          <span class="chip-title">🧪 Unit Tests</span>
          <span class="chip-desc">Generate Unit Tests for selected class/method</span>
        </button>
        <button class="action-chip" onclick="runVSCodeCommand('starfish.fixErrors')">
          <span class="chip-title">🔧 Fix Build Errors</span>
          <span class="chip-desc">Analyze diagnostics and recommend fixes</span>
        </button>
        <button class="action-chip" onclick="triggerN8nPrompt()">
          <span class="chip-title">⛓️ n8n Automation</span>
          <span class="chip-desc">Trigger a hosted workflow task</span>
        </button>
      </div>
    </div>
  </div>

  <div class="input-container">
    <textarea id="chat-input" class="chat-input" placeholder="Type a C# question or instruction..." rows="1"></textarea>
    <button id="send-btn" class="send-btn" onclick="sendMessage()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>
    </button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const chatContainer = document.getElementById('chat-container');
    const chatInput = document.getElementById('chat-input');
    const welcomeView = document.getElementById('welcome-view');
    const modelSelect = document.getElementById('model-select');

    let currentResponseBubble = null;

    // Adjust textarea height automatically
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = chatInput.scrollHeight + 'px';
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    function runVSCodeCommand(command) {
      vscode.postMessage({ type: 'runCommand', command: command });
    }

    function triggerN8nPrompt() {
      const text = chatInput.value.trim();
      if (!text) {
        alert("Please enter details of the automation request in the input box first.");
        return;
      }
      vscode.postMessage({ type: 'triggerN8n', prompt: text });
      chatInput.value = '';
    }

    function sendMessage() {
      const text = chatInput.value.trim();
      if (!text) return;

      if (welcomeView) {
        welcomeView.style.display = 'none';
      }

      vscode.postMessage({
        type: 'sendMessage',
        text: text
      });

      chatInput.value = '';
      chatInput.style.height = 'auto';
    }

    // Receive message from extension host
    window.addEventListener('message', event => {
      const message = event.data;

      switch (message.type) {
        case 'insertPrompt':
          if (welcomeView) welcomeView.style.display = 'none';
          chatInput.value = message.text;
          chatInput.style.height = 'auto';
          chatInput.style.height = chatInput.scrollHeight + 'px';
          if (message.submit) {
            sendMessage();
          }
          break;
        case 'addUserMessage':
          appendMessage('user', message.text);
          break;
        case 'startStreaming':
          currentResponseBubble = appendMessage('assistant', '');
          appendTypingIndicator();
          break;
        case 'streamChunk':
          removeTypingIndicator();
          if (currentResponseBubble) {
            const rawContent = currentResponseBubble.getAttribute('data-raw') || '';
            const newContent = rawContent + message.chunk;
            currentResponseBubble.setAttribute('data-raw', newContent);
            currentResponseBubble.innerHTML = marked.parse(newContent);
            // Re-apply Prism syntax highlighting to new code blocks
            Prism.highlightAllUnder(currentResponseBubble);
            scrollToBottom();
          }
          break;
        case 'stopStreaming':
          removeTypingIndicator();
          currentResponseBubble = null;
          break;
        case 'addAssistantMessage':
          if (welcomeView) welcomeView.style.display = 'none';
          const bubble = appendMessage('assistant', message.text);
          Prism.highlightAllUnder(bubble);
          break;
        case 'addSystemMessage':
          appendMessage('system', message.text);
          break;
        case 'error':
          appendMessage('system', '❌ ' + message.message);
          break;
        case 'chatCleared':
          chatContainer.innerHTML = '';
          if (welcomeView) {
            chatContainer.appendChild(welcomeView);
            welcomeView.style.display = 'flex';
          }
          break;
        case 'modelsUpdated':
          updateModelsDropdown(message.models, message.activeModel);
          break;
      }
    });

    function appendMessage(role, text) {
      const msgDiv = document.createElement('div');
      msgDiv.classList.add('message', role);
      if (role === 'assistant') {
        msgDiv.setAttribute('data-raw', text);
        msgDiv.innerHTML = marked.parse(text);
      } else {
        msgDiv.textContent = text;
      }
      chatContainer.appendChild(msgDiv);
      scrollToBottom();
      return msgDiv;
    }

    function appendTypingIndicator() {
      const loaderDiv = document.createElement('div');
      loaderDiv.id = 'typing-loader';
      loaderDiv.classList.add('message', 'assistant', 'typing-indicator');
      loaderDiv.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
      chatContainer.appendChild(loaderDiv);
      scrollToBottom();
    }

    function removeTypingIndicator() {
      const loader = document.getElementById('typing-loader');
      if (loader) loader.remove();
    }

    function scrollToBottom() {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function updateModelsDropdown(models, activeModel) {
      modelSelect.innerHTML = '';
      modelSelect.disabled = false;
      
      if (!models || models.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = activeModel + ' (offline)';
        modelSelect.appendChild(opt);
        return;
      }

      models.forEach(modelName => {
        const opt = document.createElement('option');
        opt.value = modelName;
        opt.textContent = modelName;
        if (modelName === activeModel) {
          opt.selected = true;
        }
        modelSelect.appendChild(opt);
      });
    }
  </script>
</body>
</html>`;
  }
}
