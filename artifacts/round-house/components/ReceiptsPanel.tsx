import React from "react";
import { Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
/** Receipts keep their existing working overlay; invoicing has its own destination. */
export function ReceiptsPanel() {
  const c = useColors();
  return <View style={{ padding: 20, gap: 10 }}><Text style={{ color: c.foreground, fontSize: 18, fontWeight: "600" }}>Receipts</Text><Text style={{ color: c.mutedForeground }}>No receipts yet.</Text></View>;
}
