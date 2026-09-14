import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueries } from '@tanstack/react-query';
import { customFetch, type ListMyEntitiesResponse, type ListEntityMembersResponse, type EntityMemberWithUser } from '@workspace/api-client-react';
import { useProfile } from '@/lib/profile';
import { useColors } from '@/hooks/useColors';
import { resolveStorageUrl } from '@/lib/uploads';
import { canReadPeople, visiblePeople, peopleRole, peopleGroup } from '@/lib/people-directory';
import { PublicProfileModal } from '@/components/PublicProfileModal';
import { messageHrefFor } from '@/lib/messageTarget';

function DirectoryContent({ onClose }: { onClose?: () => void }) {
  const c = useColors(), router = useRouter(), insets = useSafeAreaInsets();
  const { activeOutwardAccount, profile } = useProfile();
  const accountId = activeOutwardAccount?.id;
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<EntityMemberWithUser | null>(null);
  const entities = useQuery({ queryKey: ['people-entities', accountId], enabled: !!accountId,
    queryFn: () => customFetch<ListMyEntitiesResponse>('/api/entities/mine', { headers: { 'x-active-outward-account-id': String(accountId) } }) });
  const available = (entities.data?.entities ?? []).filter(e => accountId && canReadPeople(e, accountId, activeOutwardAccount?.kind ?? 'viewer'));
  const directories = useQueries({ queries: available.map(e => ({ queryKey: ['people-members', accountId, e.id],
    queryFn: () => customFetch<ListEntityMembersResponse>(`/api/entities/${e.id}/members`, { headers: { 'x-active-outward-account-id': String(accountId) } }), retry: false })) });
  const loading = entities.isLoading || directories.some(q => q.isLoading);
  const failed = entities.isError || directories.some(q => q.isError);
  const needle = search.trim().toLowerCase();
  const groups = available.flatMap((entity, index) => {
    const members = visiblePeople(directories[index].data?.members ?? [], profile?.clerkId ?? '');
    const titles = ['Home Team', 'Facility Team', 'Trade Professionals', 'Suppliers', 'Business People'];
    return titles.map(title => ({ entity, title, members: members.filter(m => peopleGroup(entity,m) === title &&
      [m.user?.name, m.user?.username, m.outwardAccount?.companyName, entity.displayName, peopleRole(m)].some(v => v?.toLowerCase().includes(needle))) })).filter(g => g.members.length);
  });
  const back = () => { onClose?.(); router.replace('/(tabs)' as never); };
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <View style={{ paddingHorizontal: 18, paddingTop: Platform.OS === 'web' ? 16 : insets.top + 10, gap: 12, paddingBottom: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Command Center" onPress={back} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Feather name="arrow-left" size={22} color={c.foreground}/><Text style={{ color: c.foreground }}>Command Center</Text>
      </Pressable>
      <Text style={{ fontSize: 28, fontWeight: '700', color: c.foreground }}>People</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
        <Feather name="search" size={18} color={c.mutedForeground}/><TextInput accessibilityLabel="Search people or properties" placeholder="Search people / properties…" placeholderTextColor={c.mutedForeground} value={search} onChangeText={setSearch} style={{ flex: 1, minHeight: 44, color: c.foreground }} />
      </View>
    </View>
    <ScrollView contentContainerStyle={{ padding: 18, gap: 18, paddingBottom: insets.bottom + 130 }}>
      {loading ? <Text style={{ color: c.mutedForeground }}>Loading people…</Text> : null}
      {failed ? <Pressable onPress={() => { void entities.refetch(); directories.forEach(q => void q.refetch()); }}><Text style={{ color: c.primary }}>Some people could not be loaded. Tap to retry.</Text></Pressable> : null}
      {!loading && !failed && !groups.length ? <View style={{ gap: 8 }}><Text style={{ color: c.foreground, fontSize: 18 }}>{needle ? 'No matches' : 'No people to show yet'}</Text><Text style={{ color: c.mutedForeground }}>{needle ? 'Try a person, Business, Property or Facility name.' : 'People appear through approved Entity participation where you have permission to view contacts. Pending invitations remain in the Invitation Center.'}</Text></View> : null}
      {groups.map(({ entity, title, members }) => <View key={`${entity.id}-${title}`} style={{ gap: 8 }}>
        <Text style={{ color: c.foreground, fontWeight: '700', fontSize: 16 }}>{title}</Text><Text style={{ color: c.mutedForeground }}>{entity.displayName}</Text>
        {members.map(m => <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`View ${m.user?.name ?? 'person'}`} onPress={() => setSelected(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, overflow: 'hidden', backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>{resolveStorageUrl(m.user?.avatarUrl) ? <Image source={{ uri: resolveStorageUrl(m.user?.avatarUrl)! }} style={{ width: 40, height: 40 }}/> : <Feather name="user" size={22} color={c.mutedForeground}/>}</View>
          <View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: c.foreground, fontWeight: '600' }}>{m.user?.name ?? m.outwardAccount?.displayName ?? 'Participant'}</Text><Text style={{ color: c.mutedForeground }}>{peopleRole(m)}</Text>{m.outwardAccount?.companyName ? <Text style={{ color: c.mutedForeground }}>{m.outwardAccount.companyName}</Text> : null}</View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Message ${m.user?.name ?? 'person'}`} style={{ padding: 10 }} onPress={event => { event.stopPropagation(); const href = messageHrefFor({ clerkId: m.userClerkId, counterpartOutwardAccountId: m.userOutwardAccountId }); if(href) router.push(href as never); }}><Feather name="mail" size={20} color={c.primary}/></Pressable>
        </Pressable>)}
      </View>)}
    </ScrollView>
    <PublicProfileModal clerkId={selected?.userClerkId ?? null} counterpartOutwardAccountId={selected?.userOutwardAccountId} visible={!!selected} onClose={() => setSelected(null)} />
  </View>;
}

export function PeopleDirectory({ onClose }: { onClose?: () => void }) {
  const { activeOutwardAccount } = useProfile();
  return <DirectoryContent key={activeOutwardAccount?.id ?? "none"} onClose={onClose}/>;
}
