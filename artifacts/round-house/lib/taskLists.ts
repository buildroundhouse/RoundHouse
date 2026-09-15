import { customFetch } from '@workspace/api-client-react';
import type { AttachmentItem } from '@/components/AttachmentList';
export type DetailFields = { note: string; quantity: string; due: string; assignee: string; room: string; attachments: AttachmentItem[] };
export type ListItem = DetailFields & { id: string; text: string; done: boolean };
export type TaskList = DetailFields & { id: string; name: string; kind: 'task'|'checklist'|'list'; propertyId: number|null; done: boolean; items: ListItem[]; revision: number };
export const emptyFields = (): DetailFields => ({note:'',quantity:'',due:'',assignee:'',room:'',attachments:[]});
export const getTaskLists = () => customFetch<{lists:TaskList[]}>('/api/task-lists');
export const saveTaskList = (list:TaskList) => customFetch<TaskList>(`/api/task-lists/${encodeURIComponent(list.id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({document:list,revision:list.revision})});
export type CaptureTarget = { label: string; accountId: number; userId: string; listId: string; itemId?: string; save: (note:string, attachments:AttachmentItem[])=>Promise<void> };
let captureTarget: CaptureTarget|null = null;
export const getTaskCaptureTarget = () => captureTarget;
export function registerTaskCaptureTarget(target:CaptureTarget) {captureTarget=target;return()=>{if(captureTarget===target)captureTarget=null;};}
