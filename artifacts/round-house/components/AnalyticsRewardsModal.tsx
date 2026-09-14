import React from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useGetFeed } from "@workspace/api-client-react";
import { BadgeTier, tierForScore, nextTier } from "./BadgeTier";

interface Props { visible: boolean; onClose: () => void; }

const BADGES = [
  ["star", "Early Sign-On Superstar"], ["zap", "Sign-On Streak"], ["share-2", "Sharing Superstar"],
  ["trending-up", "60% to Active User"], ["award", "Status Hero"], ["check-circle", "Profile 100% Complete"],
] as const;
const FUTURE_REWARDS = [
  ["tool", "Sponsored tools & equipment"], ["home", "Home & gardening products"], ["tag", "Service discounts"],
  ["trending-up", "Advertising benefits"], ["briefcase", "Brand deals & partnerships"],
] as const;

export function AnalyticsRewardsModal({ visible, onClose }: Props) {
  const colors = useColors(); const insets = useSafeAreaInsets();
  const { data: feedData } = useGetFeed(undefined, { query: { enabled: visible, queryKey: ["/api/feed"] } });
  const logs = feedData?.logs ?? []; const points = logs.reduce((sum, log) => sum + log.score, 0);
  const status = tierForScore(points); const next = nextTier(points);
  const progress = next ? Math.min(100, Math.round((points / next.min) * 100)) : 100;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : insets.top + 8 }]}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.back} accessibilityLabel="Back to Command Center"><Feather name="arrow-left" size={22} color={colors.foreground} /><Text style={[styles.backText, { color: colors.foreground }]}>Command Center</Text></Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>Reward Center</Text><View style={{ width: 112 }} />
        </View>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 28 }]}>
          <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <BadgeTier score={points} size="md" /><Text style={[styles.status, { color: colors.foreground }]}>{status.label.toUpperCase()}</Text>
            <Text style={[styles.points, { color: colors.foreground }]}>{points.toLocaleString()} pts</Text>
            <View style={[styles.track, { backgroundColor: colors.muted }]}><View style={[styles.fill, { backgroundColor: colors.primary, width: `${progress}%` }]} /></View>
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>{next ? `${Math.max(0, next.min - points).toLocaleString()} points to ${next.label}` : "Top Status reached"}</Text>
          </View>
          <SectionLabel text="BADGES" color={colors.mutedForeground} /><View style={styles.grid}>{BADGES.map(([icon, label], index) => <View key={label} style={[styles.badge, { backgroundColor: colors.card, borderColor: colors.border, opacity: index < 2 ? 1 : 0.55 }]}><Feather name={index < 2 ? icon : "lock"} size={20} color={index < 2 ? colors.primary : colors.mutedForeground} /><Text style={[styles.badgeText, { color: colors.foreground }]}>{label}</Text></View>)}</View>
          <SectionLabel text="YOUR ACTIVITY" color={colors.mutedForeground} /><View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}><Activity value="+25" text="Completed useful work" colors={colors} /><Activity value="+10" text="Shared Roundhouse" colors={colors} /><Activity value="+10" text="Daily sign-on" colors={colors} /><Activity value="+25" text="Updated Profile" colors={colors} /></View>
          <SectionLabel text="TIPS TO EARN MORE" color={colors.mutedForeground} /><View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}><Tip text="Complete your Profile" colors={colors} /><Tip text="Share Roundhouse" colors={colors} /><Tip text="Log legitimate work or participation" colors={colors} /><Tip text="Complete useful Roundhouse actions for your Role" colors={colors} /></View>
          <View style={styles.comingHeader}><Text style={[styles.comingTitle, { color: colors.foreground }]}>Coming Soon</Text><Text style={[styles.helper, { color: colors.mutedForeground }]}>Future rewards your participation may unlock.</Text></View>
          {FUTURE_REWARDS.map(([icon, label]) => <View key={label} style={[styles.future, { backgroundColor: colors.card, borderColor: colors.border }]}><Feather name={icon} size={20} color={colors.primary} /><Text style={[styles.futureText, { color: colors.foreground }]}>{label}</Text><Text style={[styles.soon, { color: colors.mutedForeground }]}>COMING SOON</Text></View>)}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.cardTitle, { color: colors.foreground }]}>Team Rewards</Text><Text style={[styles.helper, { color: colors.mutedForeground }]}>Team recognition and rewards management — Coming Soon.</Text></View>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.cardTitle, { color: colors.foreground }]}>In-House Rewards Creation Center</Text><Text style={[styles.helper, { color: colors.mutedForeground }]}>Create incentives and rewards for your team. Your organization is responsible for providing and fulfilling rewards it creates.</Text><Text style={[styles.soon, { color: colors.mutedForeground }]}>COMING SOON</Text></View>
        </ScrollView>
      </View>
    </Modal>
  );
}
function SectionLabel({ text, color }: { text: string; color: string }) { return <Text style={[styles.section, { color }]}>{text}</Text>; }
function Activity({ value, text, colors }: { value: string; text: string; colors: ReturnType<typeof useColors> }) { return <View style={styles.row}><Text style={[styles.activityValue, { color: colors.primary }]}>{value}</Text><Text style={[styles.rowText, { color: colors.foreground }]}>{text}</Text></View>; }
function Tip({ text, colors }: { text: string; colors: ReturnType<typeof useColors> }) { return <View style={styles.row}><Feather name="plus-circle" size={17} color={colors.primary} /><Text style={[styles.rowText, { color: colors.foreground }]}>{text}</Text></View>; }
const styles = StyleSheet.create({ root:{flex:1}, header:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",paddingHorizontal:16,paddingBottom:12,borderBottomWidth:StyleSheet.hairlineWidth}, back:{width:112,flexDirection:"row",alignItems:"center",gap:5}, backText:{fontSize:12,fontFamily:"Inter_600SemiBold"}, title:{fontSize:16,fontFamily:"Inter_700Bold"}, scroll:{padding:16,gap:12}, hero:{borderRadius:18,borderWidth:1,padding:22,alignItems:"center",gap:6}, status:{fontSize:25,fontFamily:"Inter_700Bold",marginTop:2}, points:{fontSize:20,fontFamily:"Inter_700Bold"}, track:{width:"100%",height:9,borderRadius:99,overflow:"hidden",marginTop:8}, fill:{height:"100%",borderRadius:99}, helper:{fontSize:12,fontFamily:"Inter_500Medium",lineHeight:18}, section:{fontSize:11,fontFamily:"Inter_700Bold",letterSpacing:.8,marginTop:7}, grid:{flexDirection:"row",flexWrap:"wrap",gap:10}, badge:{width:"48%",minHeight:82,borderRadius:14,borderWidth:1,padding:12,gap:7}, badgeText:{fontSize:12,fontFamily:"Inter_700Bold"}, card:{borderRadius:14,borderWidth:1,padding:14,gap:11}, row:{flexDirection:"row",alignItems:"center",gap:10}, activityValue:{width:38,fontSize:13,fontFamily:"Inter_700Bold"}, rowText:{flex:1,fontSize:13,fontFamily:"Inter_500Medium"}, comingHeader:{gap:3,marginTop:8}, comingTitle:{fontSize:19,fontFamily:"Inter_700Bold"}, future:{flexDirection:"row",alignItems:"center",gap:10,borderRadius:14,borderWidth:1,padding:14}, futureText:{flex:1,fontSize:13,fontFamily:"Inter_600SemiBold"}, soon:{fontSize:9,fontFamily:"Inter_700Bold",letterSpacing:.7}, cardTitle:{fontSize:14,fontFamily:"Inter_700Bold"} });
