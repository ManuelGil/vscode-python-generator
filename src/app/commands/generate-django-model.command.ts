import { Uri } from 'vscode';
import { BaseCommand } from './base.command';

export class GenerateDjangoModelCommand extends BaseCommand {
  async execute(folderPath?: Uri): Promise<void> {
    await this.service.generateTemplateByType('django-model', folderPath);
  }
}
