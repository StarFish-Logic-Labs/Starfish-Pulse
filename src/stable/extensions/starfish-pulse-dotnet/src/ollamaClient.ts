import * as vscode from 'vscode';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class OllamaClient {
  private getConfiguration() {
    const config = vscode.workspace.getConfiguration('starfish');
    return {
      url: config.get<string>('ollamaUrl', 'http://localhost:11434'),
      model: config.get<string>('ollamaModel', 'qwen2.5-coder:14b'),
      systemPrompt: config.get<string>('systemPrompt', '')
    };
  }

  public async getAvailableModels(): Promise<string[]> {
    const { url } = this.getConfiguration();
    try {
      const response = await fetch(`${url}/api/tags`);
      if (!response.ok) {
        throw new Error(`Ollama returned status ${response.status}`);
      }
      const data = await response.json() as { models?: { name: string }[] };
      return data.models?.map(m => m.name) || [];
    } catch (error) {
      console.error('Failed to fetch models from Ollama:', error);
      return [];
    }
  }

  public async *streamChat(messages: ChatMessage[], systemPromptOverride?: string): AsyncGenerator<string, void, unknown> {
    const { url, model, systemPrompt } = this.getConfiguration();
    const finalSystemPrompt = systemPromptOverride || systemPrompt;

    const fullMessages: ChatMessage[] = [];
    if (finalSystemPrompt) {
      fullMessages.push({ role: 'system', content: finalSystemPrompt });
    }
    fullMessages.push(...messages);

    const requestUrl = `${url}/api/chat`;
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: fullMessages,
        stream: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errText || response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Ollama response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean };
            if (parsed.message?.content) {
              yield parsed.message.content;
            }
          } catch (e) {
            console.warn('Failed to parse streaming JSON chunk:', trimmed, e);
          }
        }
      }

      // Process any remaining data in the buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim()) as { message?: { content?: string } };
          if (parsed.message?.content) {
            yield parsed.message.content;
          }
        } catch (e) {
          // ignore
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
