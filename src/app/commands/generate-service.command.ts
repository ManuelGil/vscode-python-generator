import { Uri } from 'vscode';
import { BaseCommand } from './base.command';

export class GenerateServiceCommand extends BaseCommand {
  async execute(folderPath?: Uri): Promise<void> {
    await this.service.generateTemplateByType('service', folderPath);
  }
}
