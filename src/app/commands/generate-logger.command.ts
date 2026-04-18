import { Uri } from 'vscode';
import { BaseCommand } from './base.command';

export class GenerateLoggerCommand extends BaseCommand {
  async execute(folderPath?: Uri): Promise<void> {
    await this.service.generateTemplateByType('logger', folderPath);
  }
}
