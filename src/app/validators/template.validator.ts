import { z } from 'zod';

export const TemplateSchema = z.object({
  id: z.string(),
  template: z.array(z.string()),
  kind: z.enum(['file', 'multi']).optional(),
  files: z.array(z.string()).optional(),
});

export function validateTemplate(input: unknown) {
  return TemplateSchema.parse(input);
}
