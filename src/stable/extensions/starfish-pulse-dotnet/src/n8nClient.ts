import * as vscode from 'vscode';
import { ProjectContext } from './contextManager';

export class N8nClient {
  public async triggerWorkflow(action: string, context: ProjectContext, payload: any): Promise<any> {
    const config = vscode.workspace.getConfiguration('starfish');
    const webhookUrl = config.get<string>('n8nWebhookUrl');

    if (!webhookUrl) {
      throw new Error('n8n Webhook URL is not configured. Please check your extension settings.');
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          timestamp: new Date().toISOString(),
          context,
          payload
        })
      });

      if (!response.ok) {
        throw new Error(`n8n workflow trigger failed with status ${response.status}: ${response.statusText}`);
      }

      // Check if response is JSON or text
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        const text = await response.text();
        return { message: text };
      }
    } catch (error: any) {
      console.error('Failed to trigger n8n workflow:', error);
      throw error;
    }
  }
}
