import { PROFILE_ROLE_LABELS, isViewerKind } from './personal-profile';
import type { MyEntityListItem, EntityMemberWithUser } from '@workspace/api-client-react';
export function canReadPeople(entity: MyEntityListItem, accountId: number, kind: string) {
  const m = entity.myMembership;
  if (!m || m.status !== 'approved' || m.archivedAt || m.userOutwardAccountId !== accountId) return false;
  if (isViewerKind(kind) && entity.kind === 'business') return false;
  if (m.permissions?.seeContacts === false) return false;
  return entity.controllerOutwardAccountId === accountId || ['owner','admin'].includes(m.role) || m.permissions?.seeContacts === true;
}
export function visiblePeople(members: EntityMemberWithUser[], self: string) {
  return members.filter(m => m.status === 'approved' && !m.archivedAt && m.userClerkId !== self && m.user && m.outwardAccount);
}
export function peopleRole(member: EntityMemberWithUser) {
  const kind = member.outwardAccount?.kind ?? '';
  if (member.role === 'collaborator' || isViewerKind(kind)) return 'Viewer';
  if (kind === 'home' && member.role === 'manager') return 'Home Manager';
  return PROFILE_ROLE_LABELS[kind] ?? 'Participant';
}
export function peopleGroup(entity: MyEntityListItem, member: EntityMemberWithUser) {
  const kind = member.outwardAccount?.kind ?? '';
  if (entity.kind === 'business') return 'Business People';
  if (kind.startsWith('trade_pro') && !isViewerKind(kind)) return 'Trade Professionals';
  if (kind === 'supplier') return 'Suppliers';
  return entity.kind === 'commercial_property' ? 'Facility Team' : 'Home Team';
}
