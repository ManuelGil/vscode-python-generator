import { Uri } from 'vscode';
import { BaseCommand } from './base.command';

export class GenerateDTOCommand extends BaseCommand {
  async execute(folderPath?: Uri): Promise<void> {
    await this.service.generateTemplateByType('dto', folderPath);
  }
}
