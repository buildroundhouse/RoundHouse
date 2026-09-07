import { usersTable, type User } from "@workspace/db";
import { sql } from "drizzle-orm";

export const publicUserColumns = {
  id: usersTable.id,
  clerkId: usersTable.clerkId,
  email: usersTable.email,
  name: usersTable.name,
  username: usersTable.username,
  bio: usersTable.bio,
  avatarUrl: usersTable.avatarUrl,
  website: usersTable.website,
  officePhone: usersTable.officePhone,
  cellPhone: usersTable.cellPhone,
  phone: usersTable.phone,
  address: usersTable.address,
  instagram: usersTable.instagram,
  companyName: usersTable.companyName,
  slogan: usersTable.slogan,
  companyLogoUrl: usersTable.companyLogoUrl,
  headerImageUrl: usersTable.headerImageUrl,
  licenseState: usersTable.licenseState,
  licenseType: usersTable.licenseType,
  licenseNumber: usersTable.licenseNumber,
  insuranceCarrier: usersTable.insuranceCarrier,
  insurancePolicyNumber: usersTable.insurancePolicyNumber,
  services: usersTable.services,
  visibility: usersTable.visibility,
  identityCompletedAt: usersTable.identityCompletedAt,
  lastActiveModeId: usersTable.lastActiveModeId,
  serviceZips: usersTable.serviceZips,
  sponsorBrandName: usersTable.sponsorBrandName,
  createdAt: usersTable.createdAt,
  updatedAt: usersTable.updatedAt,
} as const;

export const selfUserColumns = {
  ...publicUserColumns,
  notifyJobStarted: usersTable.notifyJobStarted,
  notifyJobCompleted: usersTable.notifyJobCompleted,
  addressZip: usersTable.addressZip,
  addressStreet: usersTable.addressStreet,
  addressCity: usersTable.addressCity,
  addressState: usersTable.addressState,
  hasPushToken: sql<boolean>`(${usersTable.expoPushToken} IS NOT NULL)`.as("has_push_token"),
  pushTokenUpdatedAt: usersTable.pushTokenUpdatedAt,
} as const;

export type PublicUser = Omit<
  User,
  "expoPushToken" | "notifyJobStarted" | "notifyJobCompleted" | "pushTokenUpdatedAt"
>;

export function toPublicUser(user: User): PublicUser {
  const {
    expoPushToken: _expoPushToken,
    notifyJobStarted: _notifyJobStarted,
    notifyJobCompleted: _notifyJobCompleted,
    pushTokenUpdatedAt: _pushTokenUpdatedAt,
    ...rest
  } = user;
  return rest;
}
