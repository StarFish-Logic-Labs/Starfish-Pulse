import * as vscode from 'vscode';
import { OllamaClient } from './ollamaClient';
import { ContextManager } from './contextManager';
import { N8nClient } from './n8nClient';
import { ChatWebviewProvider } from './chatWebviewProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('Activating Starfish Pulse .NET Extension...');

  // Initialize helper clients
  const ollamaClient = new OllamaClient();
  const contextManager = new ContextManager();
  const n8nClient = new N8nClient();

  // Create and register the webview provider
  const chatProvider = new ChatWebviewProvider(
    context.extensionUri,
    ollamaClient,
    contextManager,
    n8nClient
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatWebviewProvider.viewType,
      chatProvider
    )
  );

  // Register commands
  const explainCodeCmd = vscode.commands.registerCommand('starfish.explainCode', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('Open a file first to explain code.');
      return;
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    if (!selectedText) {
      vscode.window.showInformationMessage('Please select some code in the editor first.');
      return;
    }

    // Open chat sidebar and set the prompt
    await vscode.commands.executeCommand('workbench.view.extension.starfish-pulse-sidebar');
    const prompt = `Please explain this C# code and suggest improvements if any:\n\n\`\`\`csharp\n${selectedText}\n\`\`\``;
    chatProvider.insertPrompt(prompt, true);
  });

  const generateTestsCmd = vscode.commands.registerCommand('starfish.generateTests', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('Open a C# file first to generate tests.');
      return;
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    if (!selectedText) {
      vscode.window.showInformationMessage('Select a C# class or method to generate unit tests.');
      return;
    }

    await vscode.commands.executeCommand('workbench.view.extension.starfish-pulse-sidebar');
    const prompt = `Please write comprehensive unit tests (using xUnit or NUnit, and FluentAssertions or standard Assert) for this C# code. Ensure you cover happy paths and edge cases:\n\n\`\`\`csharp\n${selectedText}\n\`\`\``;
    chatProvider.insertPrompt(prompt, true);
  });

  const fixErrorsCmd = vscode.commands.registerCommand('starfish.fixErrors', async () => {
    // Show loading warning/status
    vscode.window.showInformationMessage('Analyzing project diagnostics...');
    
    const projContext = await contextManager.getWorkspaceContext();
    if (projContext.errors.length === 0) {
      vscode.window.showInformationMessage('No active compiler errors found in the workspace! Great job.');
      return;
    }

    await vscode.commands.executeCommand('workbench.view.extension.starfish-pulse-sidebar');
    
    let prompt = `I have compilation/linter errors in my .NET project. Here is the context:\n\n`;
    prompt += `Compiler Errors:\n`;
    for (const err of projContext.errors) {
      prompt += `- File: ${err.file}, Line: ${err.line}\n  Error: ${err.message}\n`;
    }
    
    if (projContext.activeFile) {
      prompt += `\nCurrently open file: ${projContext.activeFile.filename}\n`;
    }
    
    prompt += `\nHow do I fix these errors? Provide the corrected C# code.`;
    
    chatProvider.insertPrompt(prompt, true);
  });

  const resetChatCmd = vscode.commands.registerCommand('starfish.resetChat', () => {
    chatProvider.clearChat();
    vscode.window.showInformationMessage('Starfish Pulse chat history cleared.');
  });

  context.subscriptions.push(explainCodeCmd, generateTestsCmd, fixErrorsCmd, resetChatCmd);
  
  console.log('Starfish Pulse .NET Extension activated successfully.');
}

export function deactivate() {}
