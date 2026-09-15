import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
const state=vi.hoisted(()=>({pg:null as any}));
vi.mock('@workspace/db',()=>({pool:{query:async(sql:string,args?:unknown[])=>{const r=await state.pg.query(sql,args);return {...r,rowCount:r.affectedRows??r.rows.length};}}}));
vi.mock('../../middlewares/requireAuth',()=>({requireAuth:(req:any,res:any,next:any)=>{if(!req.headers['x-user'])return res.sendStatus(401);req.userId=req.headers['x-user'];req.activeOutwardAccountId=Number(req.headers['x-account']??1);next();}}));
vi.mock('../../lib/resolutionAccess',()=>({resolutionAccess:async(req:any)=>req.userId,canActOnResolution:(user:string)=>user!=='viewer'}));
vi.mock('../../lib/propertyAccess',()=>({getMembershipForProperty:async(id:number)=>id===10?{role:'worker'}:null}));
vi.mock('../../lib/objectAccess',()=>({assertCallerOwnsUploads:async(_u:string,paths:string[])=>{if(paths.includes('/objects/foreign'))throw Error('Not your upload');}}));
const app=express();app.use(express.json());
const client=(method:'get'|'put',url='/task-lists',user='alice',account=1)=>request(app)[method]('/api'+url).set('x-user',user).set('x-account',String(account));
const doc={id:'a',name:'Shopping',kind:'list',propertyId:null,items:[]};
beforeAll(async()=>{state.pg=new PGlite();app.use('/api',(await import('../task-lists')).default);app.use((_err:any,_req:any,res:any,_next:any)=>res.status(400).json({error:'Invalid upload'}));});
afterAll(async()=>state.pg.close());
it('requires authentication and isolates both people and accounts',async()=>{
 await request(app).get('/api/task-lists').expect(401);
 await client('put','/task-lists/a').send({document:doc,revision:0}).expect(200);
 expect((await client('get').expect(200)).body.lists).toHaveLength(1);
 expect((await client('get','/task-lists','bob').expect(200)).body.lists).toHaveLength(0);
 expect((await client('get','/task-lists','alice',2).expect(200)).body.lists).toHaveLength(0);
 await client('put','/task-lists/a','bob').send({document:doc,revision:1}).expect(409);
});
it('rejects viewer edits, unauthorized Property context, and stale revisions',async()=>{
 await client('put','/task-lists/a','viewer').send({document:doc,revision:1}).expect(403);
 await client('put','/task-lists/a').send({document:{...doc,propertyId:999},revision:1}).expect(403);
 await client('put','/task-lists/a').send({document:{...doc,note:'Current'},revision:1}).expect(200);
 await client('put','/task-lists/a').send({document:{...doc,note:'Stale'},revision:1}).expect(409);
});
it('stores photos on the precise item and rejects foreign attachment paths',async()=>{
 const items=[{id:'item',text:'Caulk',done:false,attachments:[{path:'/objects/owned',kind:'image'}]}];
 const r=await client('put','/task-lists/a').send({document:{...doc,items},revision:2}).expect(200);
 expect(r.body.items[0].attachments[0].path).toBe('/objects/owned');expect(r.body.attachments).toEqual([]);
 await client('put','/task-lists/a').send({document:{...doc,attachments:[{path:'/objects/foreign',kind:'image'}]},revision:3}).expect(400);
});
