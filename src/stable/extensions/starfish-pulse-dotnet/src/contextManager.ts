import * as vscode from 'vscode';
import * as path from 'path';

export interface ProjectContext {
  solutions: string[];
  projects: {
    name: string;
    path: string;
    targetFramework?: string;
    packages: string[];
  }[];
  activeFile?: {
    filename: string;
    languageId: string;
    content: string;
    selection?: string;
  };
  errors: {
    file: string;
    line: number;
    severity: string;
    message: string;
  }[];
}

export class ContextManager {
  public async getWorkspaceContext(): Promise<ProjectContext> {
    const context: ProjectContext = {
      solutions: [],
      projects: [],
      errors: []
    };

    // 1. Find .sln and .csproj files
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        // Find solutions
        const slnFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.sln'), '**/node_modules/**', 5);
        context.solutions.push(...slnFiles.map(f => path.basename(f.fsPath)));

        // Find projects
        const csprojFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.csproj'), '**/node_modules/**', 10);
        for (const file of csprojFiles) {
          try {
            const document = await vscode.workspace.openTextDocument(file);
            const content = document.getText();
            
            // Extract basic details from csproj via regex
            const targetFrameworkMatch = content.match(/<TargetFramework>(.*?)<\/TargetFramework>/);
            const targetFramework = targetFrameworkMatch ? targetFrameworkMatch[1] : undefined;

            const packages: string[] = [];
            const packageRegex = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g;
            let match;
            while ((match = packageRegex.exec(content)) !== null) {
              packages.push(`${match[1]} (${match[2]})`);
            }

            context.projects.push({
              name: path.basename(file.fsPath),
              path: vscode.workspace.asRelativePath(file),
              targetFramework,
              packages
            });
          } catch (e) {
            console.error('Failed to parse csproj file:', file.fsPath, e);
          }
        }
      }
    }

    // 2. Find active file context
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const doc = activeEditor.document;
      const selection = activeEditor.selection;
      let selectedText = '';
      if (selection && !selection.isEmpty) {
        selectedText = doc.getText(selection);
      }

      context.activeFile = {
        filename: vscode.workspace.asRelativePath(doc.uri),
        languageId: doc.languageId,
        content: doc.getText(),
        selection: selectedText || undefined
      };
    }

    // 3. Gather compiler/linter errors
    const diagnostics = vscode.languages.getDiagnostics();
    let errorCount = 0;
    for (const [uri, diagList] of diagnostics) {
      if (errorCount >= 20) break; // Limit to first 20 errors to avoid bloating context
      
      for (const diag of diagList) {
        if (diag.severity === vscode.DiagnosticSeverity.Error) {
          context.errors.push({
            file: vscode.workspace.asRelativePath(uri),
            line: diag.range.start.line + 1,
            severity: 'Error',
            message: diag.message
          });
          errorCount++;
          if (errorCount >= 20) break;
        }
      }
    }

    return context;
  }

  public formatContextPrompt(context: ProjectContext): string {
    let prompt = '';

    if (context.solutions.length > 0) {
      prompt += `Active .NET Solutions:\n${context.solutions.map(s => `- ${s}`).join('\n')}\n\n`;
    }

    if (context.projects.length > 0) {
      prompt += `Projects in Workspace:\n`;
      for (const proj of context.projects) {
        prompt += `- Project: ${proj.name} (Path: ${proj.path})\n`;
        if (proj.targetFramework) prompt += `  Target Framework: ${proj.targetFramework}\n`;
        if (proj.packages.length > 0) {
          prompt += `  Packages:\n${proj.packages.map(p => `    * ${p}`).join('\n')}\n`;
        }
      }
      prompt += '\n';
    }

    if (context.errors.length > 0) {
      prompt += `Active Compiler/Build Errors:\n`;
      for (const err of context.errors) {
        prompt += `- [${err.file}:${err.line}] (${err.severity}): ${err.message}\n`;
      }
      prompt += '\n';
    }

    if (context.activeFile) {
      prompt += `Current File: ${context.activeFile.filename} (${context.activeFile.languageId})\n`;
      if (context.activeFile.selection) {
        prompt += `--- SELECTED CODE IN EDITOR ---\n${context.activeFile.selection}\n--------------------------------\n\n`;
      } else {
        // Include truncated file contents if too large, or whole file if reasonable
        const lines = context.activeFile.content.split('\n');
        if (lines.length > 500) {
          prompt += `--- ACTIVE FILE CONTENT (TRUNCATED) ---\n${lines.slice(0, 200).join('\n')}\n... [TRUNCATED] ...\n${lines.slice(-100).join('\n')}\n---------------------------------------\n\n`;
        } else {
          prompt += `--- ACTIVE FILE CONTENT ---\n${context.activeFile.content}\n----------------------------\n\n`;
        }
      }
    }

    return prompt;
  }
}
