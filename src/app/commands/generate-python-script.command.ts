import { Uri } from 'vscode';
import { BaseCommand } from './base.command';

export class GeneratePythonScriptCommand extends BaseCommand {
  async execute(folderPath?: Uri): Promise<void> {
    await this.service.generateTemplateByType('script', folderPath);
  }
}
