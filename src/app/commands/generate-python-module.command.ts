import { Uri } from 'vscode';
import { BaseCommand } from './base.command';

export class GeneratePythonModuleCommand extends BaseCommand {
  async execute(folderPath?: Uri): Promise<void> {
    await this.service.generateTemplateByType('module', folderPath);
  }
}
