import React from "react";
import { Image, StyleSheet, View } from "react-native";

const loadingLogoBlack = require("../assets/images/loading-logo-black.png");

export function LoadingScreen() {
  return (
    <View style={styles.container}>
      <Image
        source={loadingLogoBlack}
        resizeMode="contain"
        style={styles.logo}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 240,
    height: 240,
  },
});
