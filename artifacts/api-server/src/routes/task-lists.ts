import { Router } from "express";
import { pool } from "@workspace/db";
import { taskListDocumentSchema as document } from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { resolutionAccess, canActOnResolution } from "../lib/resolutionAccess";
import { getMembershipForProperty } from "../lib/propertyAccess";
import { assertCallerOwnsUploads } from "../lib/objectAccess";

const router = Router();
let ready: Promise<unknown> | undefined;
const ensure = () => ready ??= pool.query(`CREATE TABLE IF NOT EXISTS personal_task_lists (
 id text PRIMARY KEY, user_id text NOT NULL, account_id integer NOT NULL,
 revision integer NOT NULL DEFAULT 1, document jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now())`).catch(e => { ready = undefined; throw e; });
router.use('/task-lists', requireAuth, async (req, res, next) => {
 try { if (!(req as AuthRequest).activeOutwardAccountId) { res.status(403).json({error:'Choose an account first'}); return; } await ensure(); next(); } catch(e) { next(e); }
});
router.get('/task-lists', async(req,res,next) => {
 try { const a=req as AuthRequest; const rows=await pool.query('SELECT document, revision FROM personal_task_lists WHERE user_id=$1 AND account_id=$2 ORDER BY updated_at DESC',[a.userId,a.activeOutwardAccountId]); res.json({lists:rows.rows.map(r=>({...r.document,revision:r.revision}))}); } catch(e){next(e);}
});
router.put('/task-lists/:id', async(req,res,next) => {
 try {
  const a=req as AuthRequest; const parsed=document.safeParse(req.body?.document); const revision=req.body?.revision;
  if(!parsed.success || parsed.data.id!==req.params.id || !Number.isInteger(revision) || revision<0){res.status(400).json({error:'Invalid list'});return;}
  const d=parsed.data;
  if(!canActOnResolution(await resolutionAccess(a))){res.status(403).json({error:'Viewer access is read-only'});return;}
  if(d.propertyId){ const m=await getMembershipForProperty(d.propertyId,a.userId,{activeOutwardAccountId:a.activeOutwardAccountId}); if(!m || ['viewer','collaborator'].includes(m.role)){res.status(403).json({error:'Property contribution permission required'});return;} }
  await assertCallerOwnsUploads(a.userId,[...d.attachments,...d.items.flatMap(i=>i.attachments)].map(a=>a.path));
  const params=[d.id,a.userId,a.activeOutwardAccountId,JSON.stringify(d)];
  const result=revision===0
   ? await pool.query('INSERT INTO personal_task_lists(id,user_id,account_id,document) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING revision',params)
   : await pool.query('UPDATE personal_task_lists SET document=$4,revision=revision+1,updated_at=now() WHERE id=$1 AND user_id=$2 AND account_id=$3 AND revision=$5 RETURNING revision',[...params,revision]);
  if(!result.rowCount){res.status(409).json({error:'This list changed. Reload before saving.'});return;}
  res.json({...d,revision:result.rows[0].revision});
 } catch(e){next(e);}
});
export default router;
