import { Uri } from 'vscode';
import { BaseCommand } from './base.command';

export class GenerateCliToolCommand extends BaseCommand {
  async execute(folderPath?: Uri): Promise<void> {
    await this.service.generateTemplateByType('cli', folderPath);
  }
}
