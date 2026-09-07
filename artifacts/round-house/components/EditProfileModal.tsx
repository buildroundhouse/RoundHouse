import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useUpdateMe, useCompleteModeIntake } from "@workspace/api-client-react";
import type { ProfileVisibility, ServiceEntry } from "@workspace/api-client-react";
import { uploadAsset, resolveStorageUrl } from "@/lib/uploads";
import { useProfile } from "@/lib/profile";
import { PhotoCropEditor, type CropShape } from "./PhotoCropEditor";
import { ServiceAreaEditorModal } from "./ServiceAreaEditorModal";
import { HomeBaseEditorModal } from "./HomeBaseEditorModal";
import { SERVICE_CATEGORIES, SERVICE_GROUPS } from "@/lib/serviceCategories";
import { useServiceCategoryView } from "@/lib/presetChips";

type VisibilityKey = keyof ProfileVisibility;

type CropSlot = "avatar" | "logo" | "header";
type PendingCrop = {
  slot: CropSlot;
  uri: string;
  aspect: number;
  shape: CropShape;
  fallbackName: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function EditProfileModal({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { profile, activeMode, refetchProfile, refetchModes } = useProfile();
  const updateModeIntake = useCompleteModeIntake();
  const isTradePro = activeMode?.kind === "trade_pro";
  const isHome = activeMode?.kind === "home";
  const [serviceAreaOpen, setServiceAreaOpen] = useState(false);
  const [homeBaseOpen, setHomeBaseOpen] = useState(false);
  const intakeData = (activeMode?.intakeData ?? {}) as Record<string, unknown>;
  const primaryZipDisplay =
    typeof intakeData.primaryZip === "string" ? intakeData.primaryZip : null;
  const additionalZipsCount = Array.isArray(intakeData.additionalZips)
    ? (intakeData.additionalZips as unknown[]).filter((z) => typeof z === "string").length
    : 0;
  const placeNameDisplay =
    typeof intakeData.placeName === "string" && intakeData.placeName.trim().length > 0
      ? intakeData.placeName.trim()
      : null;
  const placeAddressDisplay =
    typeof intakeData.placeAddress === "string" && intakeData.placeAddress.trim().length > 0
      ? intakeData.placeAddress.trim()
      : null;
  const updateMe = useUpdateMe();

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [slogan, setSlogan] = useState("");
  const [sloganAuthor, setSloganAuthor] = useState("");
  const [showSloganAuthor, setShowSloganAuthor] = useState(true);
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [licenseState, setLicenseState] = useState("");
  const [licenseType, setLicenseType] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [insuranceCarrier, setInsuranceCarrier] = useState("");
  const [insurancePolicyNumber, setInsurancePolicyNumber] = useState("");
  const [services, setServices] = useState<ServiceEntry[]>([]);
  const [visibility, setVisibility] = useState<ProfileVisibility>({});
  const [servicesPickerOpen, setServicesPickerOpen] = useState(false);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [companyLogoPath, setCompanyLogoPath] = useState<string | null>(null);
  const [headerImagePath, setHeaderImagePath] = useState<string | null>(null);
  const [pickedAvatarPreview, setPickedAvatarPreview] = useState<string | null>(null);
  const [pickedLogoPreview, setPickedLogoPreview] = useState<string | null>(null);
  const [pickedHeaderPreview, setPickedHeaderPreview] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingCrop, setPendingCrop] = useState<PendingCrop | null>(null);
  const uploading = uploadingAvatar || uploadingLogo || uploadingHeader;

  const initialized = useRef(false);
  useEffect(() => {
    if (!visible) {
      initialized.current = false;
      return;
    }
    if (!initialized.current && profile) {
      const md = (activeMode?.intakeData ?? {}) as Record<string, unknown>;
      const pickStr = (k: string): string | null => {
        const v = md[k];
        return typeof v === "string" && v.length > 0 ? v : null;
      };
      const pickArr = <T,>(k: string): T[] | null => {
        const v = md[k];
        return Array.isArray(v) ? (v as T[]) : null;
      };
      const pickObj = <T extends object>(k: string): T | null => {
        const v = md[k];
        return v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null;
      };
      setName(profile.name ?? "");
      setBio(pickStr("bio") ?? profile.bio ?? "");
      setCompanyName(pickStr("companyName") ?? profile.companyName ?? "");
      setSlogan(pickStr("slogan") ?? profile.slogan ?? "");
      setSloganAuthor(pickStr("sloganAuthor") ?? "");
      setShowSloganAuthor(
        typeof md.showSloganAuthor === "boolean" ? md.showSloganAuthor : true,
      );
      // Per-account contact + credentials. Each account is fully isolated;
      // changes here never bleed across accounts. Only first/last name +
      // avatar are user-level (shared identity).
      setEmail(pickStr("contactEmail") ?? "");
      setAddress(pickStr("address") ?? "");
      setPhone(pickStr("phone") ?? "");
      setWebsite(pickStr("website") ?? "");
      setInstagram(pickStr("instagram") ?? "");
      setLicenseState(pickStr("licenseState") ?? "");
      setLicenseType(pickStr("licenseType") ?? "");
      setLicenseNumber(pickStr("licenseNumber") ?? "");
      setInsuranceCarrier(pickStr("insuranceCarrier") ?? "");
      setInsurancePolicyNumber(pickStr("insurancePolicyNumber") ?? "");
      setServices(pickArr<ServiceEntry>("services") ?? []);
      setVisibility({ ...(pickObj<ProfileVisibility>("visibility") ?? {}) });
      setAvatarPath(profile.avatarUrl ?? null);
      setCompanyLogoPath(
        pickStr("companyLogoUrl") ??
          pickStr("logoUrl") ??
          profile.companyLogoUrl ??
          null,
      );
      setHeaderImagePath(
        pickStr("headerImageUrl") ??
          pickStr("bannerUrl") ??
          pickStr("coverPhotoUrl") ??
          profile.headerImageUrl ??
          null,
      );
      setPickedAvatarPreview(null);
      setPickedLogoPreview(null);
      setPickedHeaderPreview(null);
      setUploadingAvatar(false);
      setUploadingLogo(false);
      setUploadingHeader(false);
      setSaving(false);
      initialized.current = true;
    }
  }, [visible, profile, activeMode]);

  /** Open OS picker to choose a photo, then hand it off to the in-app
   *  PhotoCropEditor where the user can pinch/pan against the destination
   *  shape. We intentionally do NOT use the OS's allowsEditing crop —
   *  that gives a square frame and doesn't match the destination shape. */
  async function pickAndQueueCrop(spec: {
    slot: CropSlot;
    aspect: number;
    shape: CropShape;
    fallbackName: string;
  }) {
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Please allow photo access.");
        return;
      }
    }
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
        exif: false,
      });
    } catch (e) {
      Alert.alert("Could not open photos", e instanceof Error ? e.message : "Try again.");
      return;
    }
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setPendingCrop({
      slot: spec.slot,
      uri: asset.uri,
      aspect: spec.aspect,
      shape: spec.shape,
      fallbackName: spec.fallbackName,
    });
  }

  async function handleCropDone(out: { uri: string; width: number; height: number }) {
    const job = pendingCrop;
    setPendingCrop(null);
    if (!job) return;

    const setPreview =
      job.slot === "avatar"
        ? setPickedAvatarPreview
        : job.slot === "logo"
          ? setPickedLogoPreview
          : setPickedHeaderPreview;
    const setPath =
      job.slot === "avatar"
        ? setAvatarPath
        : job.slot === "logo"
          ? setCompanyLogoPath
          : setHeaderImagePath;
    const setUploading =
      job.slot === "avatar"
        ? setUploadingAvatar
        : job.slot === "logo"
          ? setUploadingLogo
          : setUploadingHeader;

    setPreview(out.uri);
    setUploading(true);
    try {
      const uploaded = await uploadAsset({
        uri: out.uri,
        name: job.fallbackName,
        contentType: "image/jpeg",
        size: null,
      });
      setPath(uploaded.path);
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Try again.");
      setPreview(null);
    } finally {
      setUploading(false);
    }
  }

  const pickAvatar = () =>
    pickAndQueueCrop({
      slot: "avatar",
      aspect: 1,
      shape: "circle",
      fallbackName: "avatar.jpg",
    });
  const pickLogo = () =>
    pickAndQueueCrop({
      slot: "logo",
      aspect: 1,
      shape: "roundedSquare",
      fallbackName: "logo.jpg",
    });
  const pickHeader = () =>
    pickAndQueueCrop({
      slot: "header",
      aspect: 2,
      shape: "roundedSquare",
      fallbackName: "header.jpg",
    });

  async function save() {
    if (saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Name required", "Please enter a name.");
      return;
    }
    // Required-on-save: any field flipped "Show on public profile" must be filled in.
    const requireFilled: Array<{ key: VisibilityKey; label: string; value: string | null }> = [
      { key: "email", label: "Email", value: email.trim() || null },
      { key: "address", label: "Address", value: address.trim() || null },
      { key: "phone", label: "Phone", value: phone.trim() || null },
      { key: "website", label: "Website", value: website.trim() || null },
      { key: "instagram", label: "Instagram", value: instagram.trim() || null },
      {
        key: "license",
        label: "Business license",
        value: [licenseState, licenseType, licenseNumber].map((s) => s.trim()).join("") || null,
      },
      {
        key: "insurance",
        label: "Insurance",
        value: [insuranceCarrier, insurancePolicyNumber].map((s) => s.trim()).join("") || null,
      },
    ];
    const missing = requireFilled.find((r) => visibility[r.key] && !r.value);
    if (missing) {
      Alert.alert(
        `${missing.label} required`,
        `You marked ${missing.label.toLowerCase()} as visible on your public profile — please fill it in or turn the toggle off.`,
      );
      return;
    }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      Alert.alert("Email looks off", "Please enter a valid email address.");
      return;
    }
    setSaving(true);
    try {
      // Only first/last name + avatar live at the user (identity) level.
      // Everything else is per-account. We also explicitly null any stale
      // user-level branding/contact fields so they can never bleed across
      // accounts via a fallback read path.
      const data: {
        name?: string;
        avatarUrl?: string;
        companyName?: string | null;
        slogan?: string | null;
        bio?: string | null;
        companyLogoUrl?: string | null;
        headerImageUrl?: string | null;
        address?: string | null;
        phone?: string | null;
        cellPhone?: string | null;
        officePhone?: string | null;
        website?: string | null;
        instagram?: string | null;
        licenseState?: string | null;
        licenseType?: string | null;
        licenseNumber?: string | null;
        insuranceCarrier?: string | null;
        insurancePolicyNumber?: string | null;
        services?: ServiceEntry[];
        visibility?: ProfileVisibility;
      } = {
        name: trimmedName,
        companyName: null,
        slogan: null,
        bio: null,
        companyLogoUrl: null,
        headerImageUrl: null,
        address: null,
        phone: null,
        cellPhone: null,
        officePhone: null,
        website: null,
        instagram: null,
        licenseState: null,
        licenseType: null,
        licenseNumber: null,
        insuranceCarrier: null,
        insurancePolicyNumber: null,
        services: [],
        visibility: {},
      };
      if (avatarPath && avatarPath !== profile?.avatarUrl) {
        data.avatarUrl = avatarPath;
      }
      await updateMe.mutateAsync({ data });

      // All per-account profile fields are stored on the active mode's
      // intakeData so accounts are fully isolated. Editing one account never
      // changes another. The auth-identity email (profile.email) is NOT
      // editable here — Firebase owns it.
      if (activeMode) {
        const existing = (activeMode.intakeData ?? {}) as Record<string, unknown>;
        const nextIntake: Record<string, unknown> = {
          ...existing,
          companyName: companyName.trim() || null,
          slogan: slogan.trim() || null,
          sloganAuthor: sloganAuthor.trim() || null,
          showSloganAuthor,
          bio: bio.trim() || null,
          companyLogoUrl: companyLogoPath || null,
          headerImageUrl: headerImagePath || null,
          contactEmail: email.trim() || null,
          address: address.trim() || null,
          phone: phone.trim() || null,
          website: website.trim() || null,
          instagram: instagram.trim().replace(/^@/, "") || null,
          licenseState: licenseState.trim() || null,
          licenseType: licenseType.trim() || null,
          licenseNumber: licenseNumber.trim() || null,
          insuranceCarrier: insuranceCarrier.trim() || null,
          insurancePolicyNumber: insurancePolicyNumber.trim() || null,
          services,
          visibility,
        };
        await updateModeIntake.mutateAsync({
          modeId: activeMode.id,
          data: { intakeData: nextIntake },
        });
      }

      await refetchProfile();
      await refetchModes();
      await queryClient.invalidateQueries({ queryKey: ["/api/users/me"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/users/me/modes"] });
      onClose();
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  const mediaVersion = profile?.updatedAt ?? null;
  const avatarPreviewUri = pickedAvatarPreview ?? resolveStorageUrl(avatarPath, mediaVersion);
  const logoPreviewUri = pickedLogoPreview ?? resolveStorageUrl(companyLogoPath, mediaVersion);
  const headerPreviewUri = pickedHeaderPreview ?? resolveStorageUrl(headerImagePath, mediaVersion);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : insets.top + 8 },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={20} style={{ padding: 8 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>Edit profile</Text>
          <Pressable onPress={save} disabled={saving || uploading} hitSlop={20} style={{ padding: 8 }}>
            <Text
              style={[
                styles.saveText,
                { color: saving || uploading ? colors.mutedForeground : colors.primary },
              ]}
            >
              {saving ? "…" : "Save"}
            </Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
            {/* Header background image picker */}
            <Text style={[styles.label, { color: colors.mutedForeground, marginBottom: 8 }]}>
              HEADER BACKGROUND
            </Text>
            <Pressable
              onPress={pickHeader}
              disabled={uploading}
              style={[styles.headerPicker, { borderColor: colors.border, backgroundColor: colors.card }]}
              accessibilityLabel="Upload Photo"
              accessibilityRole="button"
            >
              {headerPreviewUri ? (
                <Image source={{ uri: headerPreviewUri }} style={styles.headerImg} />
              ) : (
                <View style={styles.headerEmpty}>
                  <Feather name="image" size={22} color={colors.mutedForeground} />
                </View>
              )}
              {/* Always-visible Upload Photo CTA — works whether the banner
                  is empty, showing a default trade banner, or a user photo.
                  Makes it obvious the banner is editable / replaceable. */}
              <View pointerEvents="none" style={styles.headerCtaWrap}>
                <View style={styles.headerCtaPill}>
                  <Feather name="camera" size={14} color="#fff" />
                  <Text style={styles.headerCtaText}>Upload Photo</Text>
                </View>
              </View>
              {uploadingHeader ? (
                <View style={styles.uploadingOverlay}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </Pressable>
            <Text style={[styles.headerHint, { color: colors.mutedForeground }]}>
              Tap the banner to upload or replace your photo.
            </Text>

            {/* Avatar + Logo side by side */}
            <View style={styles.dualRow}>
              <View style={styles.dualItem}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>PROFILE PHOTO</Text>
                <Pressable
                  onPress={pickAvatar}
                  disabled={uploading}
                  style={[styles.avatar, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  {avatarPreviewUri ? (
                    <Image source={{ uri: avatarPreviewUri }} style={styles.avatarImage} resizeMode="cover" />
                  ) : (
                    <Feather name="camera" size={24} color={colors.mutedForeground} />
                  )}
                  {uploadingAvatar ? (
                    <View style={styles.uploadingOverlay}>
                      <ActivityIndicator color="#fff" />
                    </View>
                  ) : null}
                </Pressable>
              </View>
              <View style={styles.dualItem}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>COMPANY LOGO</Text>
                <Pressable
                  onPress={pickLogo}
                  disabled={uploading}
                  style={[styles.logoBox, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  {logoPreviewUri ? (
                    <Image source={{ uri: logoPreviewUri }} style={styles.avatarImage} resizeMode="cover" />
                  ) : (
                    <Feather name="briefcase" size={22} color={colors.mutedForeground} />
                  )}
                  {uploadingLogo ? (
                    <View style={styles.uploadingOverlay}>
                      <ActivityIndicator color="#fff" />
                    </View>
                  ) : null}
                </Pressable>
              </View>
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 18 }]}>
              COMPANY NAME
            </Text>
            <TextInput
              value={companyName}
              onChangeText={setCompanyName}
              placeholder="e.g., Mike's Construction"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
              ]}
              maxLength={80}
            />

            <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 18 }]}>SLOGAN</Text>
            <TextInput
              value={slogan}
              onChangeText={setSlogan}
              placeholder="e.g., Quality and Pride"
              placeholderTextColor={colors.mutedForeground}
              multiline
              textAlignVertical="top"
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  minHeight: 64,
                },
              ]}
              maxLength={140}
            />
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 11,
                fontFamily: "Inter_500Medium",
                marginTop: 4,
              }}
            >
              Shows in parentheses next to your logo. Up to ~2 short sentences.
            </Text>

            <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 14 }]}>
              SLOGAN AUTHOR
            </Text>
            <TextInput
              value={sloganAuthor}
              onChangeText={setSloganAuthor}
              placeholder="e.g., — Mark Twain"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
              ]}
              maxLength={60}
            />
            <View style={[styles.visRow, { marginTop: 8 }]}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                Show slogan author
              </Text>
              <Switch
                value={showSloganAuthor}
                onValueChange={setShowSloganAuthor}
              />
            </View>

            <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 18 }]}>NAME</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
              ]}
              maxLength={80}
            />

            <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 18 }]}>ABOUT SERVICES</Text>
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="Tell people about your services (optional)"
              placeholderTextColor={colors.mutedForeground}
              multiline
              textAlignVertical="top"
              style={[
                styles.input,
                styles.textarea,
                {
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  minHeight: 160,
                },
              ]}
              maxLength={1000}
            />

            {isTradePro ? (
              <>
                <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 18 }]}>
                  SERVICE AREA
                </Text>
                <Pressable
                  onPress={() => setServiceAreaOpen(true)}
                  style={[
                    styles.serviceAreaRow,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Edit service area ZIPs"
                >
                  <Feather name="map-pin" size={18} color={colors.mutedForeground} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.serviceAreaTitle, { color: colors.foreground }]}>
                      {primaryZipDisplay ? `Primary ${primaryZipDisplay}` : "Set primary ZIP"}
                    </Text>
                    <Text
                      style={[styles.serviceAreaSub, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {additionalZipsCount > 0
                        ? `+${additionalZipsCount} other ZIP${additionalZipsCount === 1 ? "" : "s"}`
                        : "Add nearby ZIPs you serve"}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
              </>
            ) : null}

            {isHome ? (
              <>
                <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 18 }]}>
                  HOME BASE
                </Text>
                <Pressable
                  onPress={() => setHomeBaseOpen(true)}
                  style={[
                    styles.serviceAreaRow,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Edit home base property and address"
                >
                  <Feather name="home" size={18} color={colors.mutedForeground} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.serviceAreaTitle, { color: colors.foreground }]}>
                      {placeNameDisplay ?? "Name your property"}
                    </Text>
                    <Text
                      style={[styles.serviceAreaSub, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {placeAddressDisplay ?? "Add a street address"}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
              </>
            ) : null}

            <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>
              CONTACT & SOCIAL
            </Text>
            <Text style={[styles.helper, { color: colors.mutedForeground, marginBottom: 12 }]}>
              Each row has a “Show on public profile” switch.
            </Text>

            <FieldWithVisibility
              label="ADDRESS"
              value={address}
              onChangeText={setAddress}
              placeholder="123 Main St, City, State"
              colors={colors}
              vis={visibility}
              setVis={setVisibility}
              visKey="address"
            />
            <FieldWithVisibility
              label="PHONE"
              value={phone}
              onChangeText={setPhone}
              placeholder="(555) 555-1234"
              keyboardType="phone-pad"
              colors={colors}
              vis={visibility}
              setVis={setVisibility}
              visKey="phone"
            />
            <FieldWithVisibility
              label="WEBSITE"
              value={website}
              onChangeText={setWebsite}
              placeholder="https://yourcompany.com"
              autoCapitalize="none"
              colors={colors}
              vis={visibility}
              setVis={setVisibility}
              visKey="website"
            />
            <FieldWithVisibility
              label="INSTAGRAM"
              value={instagram}
              onChangeText={setInstagram}
              placeholder="@yourcompany"
              autoCapitalize="none"
              colors={colors}
              vis={visibility}
              setVis={setVisibility}
              visKey="instagram"
            />
            <FieldWithVisibility
              label="EMAIL"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              colors={colors}
              vis={visibility}
              setVis={setVisibility}
              visKey="email"
            />

            <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>SERVICES</Text>
            <InlineServicesField
              services={services}
              onChange={setServices}
              colors={colors}
            />
            <View style={[styles.visRow, { marginTop: 10 }]}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                Show services on public profile
              </Text>
              <Switch
                value={visibility.services !== false}
                onValueChange={(v) => setVisibility((cur) => ({ ...cur, services: v }))}
              />
            </View>

            <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>
              BUSINESS LICENSE
            </Text>
            <View style={styles.dualRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>STATE</Text>
                <TextInput
                  value={licenseState}
                  onChangeText={setLicenseState}
                  placeholder="CA"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="characters"
                  maxLength={4}
                  style={[
                    styles.input,
                    { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                />
              </View>
              <View style={{ flex: 2 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>TYPE</Text>
                <TextInput
                  value={licenseType}
                  onChangeText={setLicenseType}
                  placeholder="e.g. C-10 Electrical"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    styles.input,
                    { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                />
              </View>
            </View>
            <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 12 }]}>
              LICENSE NUMBER
            </Text>
            <TextInput
              value={licenseNumber}
              onChangeText={setLicenseNumber}
              placeholder="License #"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              style={[
                styles.input,
                { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
              ]}
            />
            <View style={[styles.visRow, { marginTop: 10 }]}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                Show license on public profile
              </Text>
              <Switch
                value={!!visibility.license}
                onValueChange={(v) => setVisibility((cur) => ({ ...cur, license: v }))}
              />
            </View>

            <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>INSURANCE</Text>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>CARRIER</Text>
            <TextInput
              value={insuranceCarrier}
              onChangeText={setInsuranceCarrier}
              placeholder="e.g. State Farm"
              placeholderTextColor={colors.mutedForeground}
              style={[
                styles.input,
                { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
              ]}
            />
            <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 12 }]}>
              POLICY NUMBER
            </Text>
            <TextInput
              value={insurancePolicyNumber}
              onChangeText={setInsurancePolicyNumber}
              placeholder="Policy #"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              style={[
                styles.input,
                { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
              ]}
            />
            <View style={[styles.visRow, { marginTop: 10 }]}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                Show insurance on public profile
              </Text>
              <Switch
                value={!!visibility.insurance}
                onValueChange={(v) => setVisibility((cur) => ({ ...cur, insurance: v }))}
              />
            </View>

            <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>
              MORE PUBLIC PROFILE OPTIONS
            </Text>
            <View style={styles.visRow}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                Show team on public profile
              </Text>
              <Switch
                value={!!visibility.team}
                onValueChange={(v) => setVisibility((cur) => ({ ...cur, team: v }))}
              />
            </View>
            <View style={[styles.visRow, { marginTop: 10 }]}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                Show analytics & badges on public profile
              </Text>
              <Switch
                value={!!visibility.analytics}
                onValueChange={(v) => setVisibility((cur) => ({ ...cur, analytics: v }))}
              />
            </View>

            {profile?.username ? (
              <Text style={[styles.helper, { color: colors.mutedForeground, marginTop: 18 }]}>
                Your username is @{profile.username}. Username changes aren't supported here yet.
              </Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      <ServiceAreaEditorModal
        visible={serviceAreaOpen}
        onClose={() => setServiceAreaOpen(false)}
      />

      <HomeBaseEditorModal
        visible={homeBaseOpen}
        onClose={() => setHomeBaseOpen(false)}
      />

      {/* In-app crop editor: pinch + pan against the destination shape. */}
      <PhotoCropEditor
        visible={!!pendingCrop}
        sourceUri={pendingCrop?.uri ?? null}
        aspect={pendingCrop?.aspect ?? 1}
        shape={pendingCrop?.shape ?? "circle"}
        title={
          pendingCrop?.slot === "avatar"
            ? "Position profile photo"
            : pendingCrop?.slot === "logo"
              ? "Position logo"
              : "Position banner"
        }
        onCancel={() => setPendingCrop(null)}
        onDone={handleCropDone}
      />
    </Modal>
  );
}

/**
 * Inline services field shown directly inside the profile editor.
 *
 * Collapsed: a tappable box that lists every currently-selected service
 * as a chip (or a "Tap to choose services" hint when empty), plus a
 * chevron that hints at the dropdown.
 *
 * Expanded: a panel underneath the box containing every preset option
 * from SERVICE_CATEGORIES — tapping any chip toggles it on/off. Custom
 * (free-form) services are not allowed; only curated presets.
 */
function InlineServicesField({
  services,
  onChange,
  colors,
}: {
  services: ServiceEntry[];
  onChange: (next: ServiceEntry[]) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const [open, setOpen] = useState(false);
  const norm = (s: string) => s.trim().toLowerCase();
  const pickedSet = new Set(services.map((s) => norm(s.name)));

  // Live admin-managed groups when available; static fallback keeps
  // the picker working before the first server response.
  const liveGroups = useServiceCategoryView();
  const groupsToRender: { label: string; items: string[] }[] = liveGroups
    ? liveGroups.groups.map((g) => ({
        label: g.label,
        items: g.items.map((i) => i.label),
      }))
    : SERVICE_GROUPS.map((g) => ({ label: g.label, items: [...g.items] }));

  function toggle(name: string) {
    const key = norm(name);
    if (pickedSet.has(key)) {
      onChange(services.filter((s) => norm(s.name) !== key));
    } else {
      onChange([...services, { name, isCustom: false }]);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={open ? "Close services list" : "Open services list"}
        style={[
          styles.inlineServicesBox,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={{ flex: 1 }}>
          {services.length === 0 ? (
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_500Medium",
                fontSize: 14,
              }}
            >
              Tap to choose services
            </Text>
          ) : (
            <View style={styles.inlineChipWrap}>
              {services.map((s) => (
                <View
                  key={s.name}
                  style={[
                    styles.inlineChip,
                    {
                      backgroundColor: colors.primary + "15",
                      borderColor: colors.primary + "40",
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: colors.foreground,
                      fontFamily: "Inter_500Medium",
                      fontSize: 12,
                    }}
                  >
                    {s.name}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.mutedForeground}
        />
      </Pressable>

      {open ? (
        <View
          style={[
            styles.inlineServicesDropdown,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              shadowColor: "#000",
            },
          ]}
        >
          <ScrollView
            style={{ maxHeight: 320 }}
            contentContainerStyle={{ padding: 12, gap: 10 }}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            {groupsToRender.map((group, gi) => (
              <View key={group.label} style={{ gap: 6 }}>
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 10,
                    fontFamily: "Inter_700Bold",
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    marginTop: gi === 0 ? 0 : 4,
                  }}
                >
                  {group.label}
                </Text>
                <View style={styles.inlineChipWrap}>
                  {group.items.map((name) => {
                    const active = pickedSet.has(norm(name));
                    return (
                      <Pressable
                        key={name}
                        onPress={() => toggle(name)}
                        style={[
                          styles.inlineChip,
                          {
                            backgroundColor: active
                              ? colors.primary
                              : colors.background,
                            borderColor: active
                              ? colors.primary
                              : colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: active
                              ? colors.primaryForeground ?? "#fff"
                              : colors.foreground,
                            fontFamily: active
                              ? "Inter_700Bold"
                              : "Inter_500Medium",
                            fontSize: 12,
                          }}
                        >
                          {name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  saveText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  scroll: { padding: 20 },
  headerPicker: {
    width: "100%",
    height: 140,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 18,
  },
  headerImg: { width: "100%", height: "100%" },
  headerEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  headerEmptyText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  headerCtaWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCtaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  headerCtaText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  headerHint: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    marginTop: -10,
    marginBottom: 18,
  },
  dualRow: { flexDirection: "row", gap: 16, marginBottom: 4 },
  dualItem: { flex: 1, alignItems: "flex-start" },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoBox: {
    width: 90,
    height: 90,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoCta: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  label: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  textarea: { minHeight: 100, textAlignVertical: "top", paddingTop: 12 },
  helper: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  serviceAreaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  serviceAreaTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  serviceAreaSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  sectionHeader: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
    marginTop: 26,
    marginBottom: 10,
  },
  visRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 6,
  },
  inlineServicesBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 48,
  },
  inlineServicesDropdown: {
    borderRadius: 10,
    borderWidth: 1,
    maxHeight: 320,
    overflow: "hidden",
    // Float visibly above the rest of the form so chips don't visually
    // bleed into the row below the dropdown.
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
  },
  inlineChipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  inlineChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
});

function FieldWithVisibility({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  colors,
  vis,
  setVis,
  visKey,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  placeholder: string;
  keyboardType?: "default" | "phone-pad" | "email-address" | "url";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  colors: ReturnType<typeof useColors>;
  vis: ProfileVisibility;
  setVis: React.Dispatch<React.SetStateAction<ProfileVisibility>>;
  visKey: VisibilityKey;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={[
          styles.input,
          { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
        ]}
      />
      <View style={[styles.visRow, { marginTop: 6 }]}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
          Show on public profile
        </Text>
        <Switch
          value={!!vis[visKey]}
          onValueChange={(v) => setVis((cur) => ({ ...cur, [visKey]: v }))}
        />
      </View>
    </View>
  );
}
