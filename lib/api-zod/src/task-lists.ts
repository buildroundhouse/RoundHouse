import { z } from "zod";

const attachment = z.object({ path: z.string().startsWith('/objects/').max(500), kind: z.enum(['image','file']), name: z.string().max(300).optional(), contentType: z.string().max(150).optional(), size: z.number().nonnegative().optional() });
const fields = { note: z.string().max(10000).default(''), quantity: z.string().max(80).default(''), due: z.string().max(80).default(''), assignee: z.string().max(150).default(''), room: z.string().max(150).default(''), attachments: z.array(attachment).max(100).default([]) };
const item = z.object({ id: z.string().min(1).max(100), text: z.string().trim().min(1).max(500), done: z.boolean(), ...fields });
export const taskListDocumentSchema = z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(150), kind: z.enum(['task','checklist','list']), propertyId: z.number().int().positive().nullable(), done: z.boolean().default(false), ...fields, items: z.array(item).max(500) });
