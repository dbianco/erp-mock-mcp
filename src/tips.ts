import { z } from 'zod';

export const TipSchema = z.object({ id: z.string(), topic: z.string(), title: z.string(), text: z.string() });
export type Tip = z.infer<typeof TipSchema>;
