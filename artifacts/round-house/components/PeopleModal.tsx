import React from "react";
import { Modal } from "react-native";
import type { RelationshipPerson } from "@workspace/api-client-react";
import { PeopleDirectory } from "./PeopleDirectory";
interface Props {
  visible: boolean;
  onClose: () => void;
  core: RelationshipPerson[];
  clients: RelationshipPerson[];
  collaborators: RelationshipPerson[];
  loading?: boolean;
  /** #643 — pair-aware tap: receivers may use the optional
   *  counterpartOutwardAccountId to target the exact skin pair when
   *  opening downstream sheets (e.g. so the public profile's Message
   *  button can pin the same outward account the row points at). */
  onPersonPress?: (clerkId: string, counterpartOutwardAccountId?: number | null) => void;
  /** #643 — open an inbox thread with the given person. */
  onMessagePress?: (person: RelationshipPerson) => void;
  /** #643 — open an inbox thread with a teammate (clerkId only). */
  onTeammateMessagePress?: (clerkId: string) => void;
}

export function PeopleModal({visible,onClose}: Props) { return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>{visible ? <PeopleDirectory onClose={onClose}/> : null}</Modal>; }
