import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useListProperties } from '@workspace/api-client-react';
import { useProfile } from '@/lib/profile';
import { useAuth } from '@/lib/auth';
import { isViewerKind } from '@/lib/personal-profile';
import { AttachmentList } from './AttachmentList';
import { emptyFields, getTaskLists, saveTaskList, registerTaskCaptureTarget, type TaskList, type ListItem } from '@/lib/taskLists';
import { newId } from '@/lib/customLists';

const fg='#f1f2f4', muted='#a8adb6';
export function TasksListsSheet({onRequestAdd}:{onRequestAdd:(fn:(()=>void)|null)=>void}) {
 const {userId}=useAuth(); const {activeOutwardAccountId,activeOutwardAccount,activeMode}=useProfile();
 const readOnly=isViewerKind(activeOutwardAccount?.kind??activeMode?.kind);
 const key=['task-lists',userId,activeOutwardAccountId]; const cache=useQueryClient();
 const query=useQuery({queryKey:key,queryFn:getTaskLists,enabled:!!userId&&!!activeOutwardAccountId});
 const {data:properties}=useListProperties();
 const [property,setProperty]=useState<number|null>(null),[opened,setOpened]=useState<TaskList|null>(null),[itemId,setItemId]=useState<string|null>(null);
 const [creating,setCreating]=useState(false),[name,setName]=useState(''),[kind,setKind]=useState<TaskList['kind']>('list'),[newText,setNewText]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''); const openedRef=useRef(opened);openedRef.current=opened;
 const listRows=query.data?.lists??[]; const item=opened?.items.find(i=>i.id===itemId);
 const startCreate=useCallback(()=>{setCreating(true);setName('');setKind('list');setError('');},[]);
 useEffect(()=>{onRequestAdd(readOnly?null:startCreate);return()=>onRequestAdd(null);},[onRequestAdd,readOnly,startCreate]);
 async function persist(list:TaskList){
  const saved=await saveTaskList(list);setOpened(saved);openedRef.current=saved;
  cache.setQueryData<{lists:TaskList[]}>(key,old=>({lists:[saved,...(old?.lists??[]).filter(l=>l.id!==saved.id)]}));return saved;
 }
 async function run(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Could not save. Please try again.');}finally{setBusy(false);}}
 useEffect(()=>{
  if(!opened||!userId||!activeOutwardAccountId||readOnly)return;
  const listId=opened.id,targetItem=itemId;
  return registerTaskCaptureTarget({label:item?.text??opened.name,accountId:activeOutwardAccountId,userId,listId,itemId:targetItem??undefined,save:async(note,attachments)=>{
   const latest=openedRef.current;if(!latest||latest.id!==listId)throw Error('Reopen the original list to save this capture.');
   if(targetItem&&!latest.items.some(i=>i.id===targetItem))throw Error('The original item is no longer available.');
   const append=<T extends {note:string;attachments:typeof attachments}>(value:T):T=>({...value,note:[value.note,note].filter(Boolean).join('\n'),attachments:[...value.attachments,...attachments]});
   await persist(targetItem?{...latest,items:latest.items.map(i=>i.id===targetItem?append(i):i)}:append(latest));
  }});
 },[opened?.id,itemId,userId,activeOutwardAccountId,readOnly,item?.text]);
 const button=(label:string,action:()=>void,disabled=false)=><Pressable accessibilityRole="button" accessibilityLabel={label} onPress={action} disabled={disabled||busy} style={s.action}><Text style={{color:disabled||busy?muted:fg}}>{label}</Text></Pressable>;
 const row=(label:string,action:()=>void,detail?:string)=><Pressable key={label} onPress={action} accessibilityRole="button" style={s.row}><View style={{flex:1}}><Text style={s.text} numberOfLines={1}>{label}</Text>{detail?<Text style={s.secondary}>{detail}</Text>:null}</View><Feather name="chevron-right" size={15} color={muted}/></Pressable>;
 const check=(done:boolean,action:()=>void,label:string)=><Pressable accessibilityRole="checkbox" accessibilityState={{checked:done,disabled:readOnly}} accessibilityLabel={label} disabled={readOnly||busy} onPress={action} style={s.check}><Feather name={done?'check-square':'square'} size={20} color={muted}/></Pressable>;
 const open=(l:TaskList)=>{setOpened(l);setProperty(l.propertyId);setItemId(null);setCreating(false);setError('');};
 const create=()=>run(async()=>{const l:TaskList={id:newId(),name:name.trim(),kind,propertyId:property,done:false,...emptyFields(),items:[],revision:0};await persist(l);setCreating(false);setItemId(null);});
 const changeField=(field:string,value:string)=>setOpened(l=>!l?l:itemId?{...l,items:l.items.map(i=>i.id===itemId?{...i,[field]:value}:i)}:{...l,[field]:value});
 const detail=opened&&(item??opened);
 return <View style={s.root}>
  <Text style={s.helper}>Use CAPTURE to take and add photos.</Text>
  <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
   {error?<Text accessibilityRole="alert" style={s.error}>{error}</Text>:null}
   {query.isPending?<ActivityIndicator color={fg}/>:query.isError?<>{button('Retry loading lists',()=>void query.refetch())}<Text style={s.secondary}>Your lists could not be loaded.</Text></>:null}
   {creating?<>
    {button('Cancel',()=>setCreating(false))}
    <Text style={s.secondary}>{property?properties?.properties.find(p=>p.id===property)?.name:'Personal'} · Private / Internal</Text>
    {property?<View style={s.inline}>{(['task','checklist','list'] as const).map(k=>button(`${kind===k?'✓ ':''}${k[0].toUpperCase()+k.slice(1)}`,()=>setKind(k)))}</View>:null}
    <TextInput accessibilityLabel="New list or task name" placeholder="Name" placeholderTextColor={muted} value={name} onChangeText={setName} style={s.input} autoFocus maxLength={150}/>
    {button('Create',create,!name.trim())}
   </>:opened?<>
    {button(itemId?'Back to list':'All lists',()=>{if(itemId)setItemId(null);else setOpened(null);setError('');})}
    <Text style={s.heading}>{item?.text??opened.name}</Text>
    <Text style={s.secondary}>Private / Internal{opened.propertyId?` · ${properties?.properties.find(p=>p.id===opened.propertyId)?.name??'Property'}`:''}</Text>
    {item||opened.kind==='task'?<>
     <View style={s.inline}>{check(item?.done??opened.done,()=>void run(()=>persist(item?{...opened,items:opened.items.map(i=>i.id===itemId?{...i,done:!i.done}:i)}:{...opened,done:!opened.done})),'Completed')}<Text style={s.text}>Complete</Text></View>
     <TextInput accessibilityLabel="Title" value={item?.text??opened.name} onChangeText={v=>changeField(item?'text':'name',v)} editable={!readOnly} style={s.input}/>
    </>:<>
     {opened.items.map(i=><View key={i.id} style={s.itemRow}>{check(i.done,()=>void run(()=>persist({...opened,items:opened.items.map(v=>v.id===i.id?{...v,done:!v.done}:v)})),i.text)}<Pressable onPress={()=>setItemId(i.id)} style={{flex:1,paddingVertical:11}} accessibilityRole="button"><Text style={[s.text,i.done&&s.done]}>{i.text}</Text>{[i.quantity,i.due,i.assignee,i.room].filter(Boolean).length?<Text style={s.secondary}>{[i.quantity,i.due,i.assignee,i.room].filter(Boolean).join(' · ')}</Text>:null}</Pressable></View>)}
     {!readOnly?<View style={s.inline}><TextInput accessibilityLabel="New item" placeholder="Add item" placeholderTextColor={muted} value={newText} onChangeText={setNewText} style={[s.input,{flex:1}]} maxLength={500}/>{button('+',()=>void run(async()=>{const i:ListItem={id:newId(),text:newText.trim(),done:false,...emptyFields()};await persist({...opened,items:[...opened.items,i]});setNewText('');}),!newText.trim())}</View>:null}
    </>}
    {detail?<>
     <TextInput accessibilityLabel="Notes" placeholder="Notes" placeholderTextColor={muted} multiline editable={!readOnly} value={detail.note} onChangeText={v=>changeField('note',v)} style={[s.input,{minHeight:72,textAlignVertical:'top'}]}/>
     {item||opened.kind==='task'?(['quantity','due','assignee','room'] as const).map(field=><TextInput key={field} accessibilityLabel={field} placeholder={field==='due'?'Due date (optional)':`${field[0].toUpperCase()+field.slice(1)} (optional)`} placeholderTextColor={muted} value={detail[field]} editable={!readOnly} onChangeText={v=>changeField(field,v)} style={s.input}/>):null}
     <AttachmentList attachments={detail.attachments} size="sm"/>
     {!readOnly?button('Save changes',()=>void run(()=>persist(opened)),!(item?.text??opened.name).trim()):null}
    </>:null}
   </>:!query.isPending&&!query.isError?<>
    {listRows.filter(l=>!l.propertyId).map(l=>row(l.name,()=>open(l)))}
    {!readOnly?['Shopping','Materials','Tomorrow','Punch List'].filter(name=>!listRows.some(l=>!l.propertyId&&l.name===name)).map(label=>row(label,()=>void run(async()=>{const l:TaskList={id:newId(),name:label,kind:'list',propertyId:null,done:false,...emptyFields(),items:[],revision:0};await persist(l);} ))):null}
    <Text style={s.section}>Properties / jobs</Text>
    {(properties?.properties??[]).map(p=><View key={p.id}>{row(p.name,()=>setProperty(property===p.id?null:p.id))}{property===p.id?<View style={s.indented}>{listRows.filter(l=>l.propertyId===p.id).map(l=>row(l.name,()=>open(l)))}{!listRows.some(l=>l.propertyId===p.id)?<Text style={s.secondary}>No lists yet.</Text>:null}{!readOnly?button('+ New',startCreate):null}</View>:null}</View>)}
    {!properties?.properties.length?<Text style={s.secondary}>Your relevant Properties and jobs appear here.</Text>:null}
    <Text style={s.footer}>Remember it. Organize it. Check it off.</Text>
   </>:null}
  </ScrollView>
 </View>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:'#17191d'},helper:{color:muted,fontSize:12,paddingHorizontal:14,paddingVertical:9},content:{paddingHorizontal:14,paddingBottom:120},row:{minHeight:44,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#34373e',flexDirection:'row',alignItems:'center',gap:8},itemRow:{flexDirection:'row',alignItems:'center',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#34373e'},text:{fontSize:15,color:fg},secondary:{fontSize:11,color:muted,lineHeight:16},heading:{fontSize:20,color:fg,marginVertical:8},section:{fontSize:12,color:muted,marginTop:24,marginBottom:6},input:{color:fg,fontSize:14,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#41454d',paddingVertical:10,marginVertical:4},inline:{flexDirection:'row',alignItems:'center',gap:8},check:{minWidth:40,minHeight:44,justifyContent:'center'},action:{minHeight:44,justifyContent:'center',paddingHorizontal:4,alignSelf:'flex-start'},indented:{paddingLeft:14},done:{textDecorationLine:'line-through',color:muted},footer:{color:muted,fontSize:11,marginTop:28},error:{color:'#ffacac',fontSize:12,marginVertical:8}});
